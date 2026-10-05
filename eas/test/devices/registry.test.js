import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DeviceRegistry, RegistryError, parseDevicectlDevices, parseMacHardware } from '../../src/devices/registry.js';

/** A fetch that records each call and answers from a script. */
function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, ...init, body: init.body ? JSON.parse(init.body) : undefined });
    const [status, body] = responses.shift();
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, impl };
}

describe('device registry client', () => {
  it('sends the bearer token and unwraps the device', async () => {
    const { calls, impl } = fakeFetch([[201, { device: { udid: 'U', status: 'pending' } }]]);
    const registry = new DeviceRegistry({ url: 'https://x.dev', token: 't0k', fetchImpl: impl });
    const device = await registry.add({ udid: 'U', name: 'A', source: 'manual' });
    assert.equal(device.status, 'pending');
    assert.equal(calls[0].url, 'https://x.dev/api/devices');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers.authorization, 'Bearer t0k');
    assert.deepEqual(calls[0].body, { udid: 'U', name: 'A', source: 'manual' });
  });

  it('filters by status and escapes UDIDs in paths', async () => {
    const { calls, impl } = fakeFetch([
      [200, { devices: [] }],
      [200, { device: { udid: 'a/b' } }],
    ]);
    const registry = new DeviceRegistry({ url: 'https://x.dev', token: 't', fetchImpl: impl });
    await registry.list({ status: 'pending' });
    await registry.remove('a/b');
    assert.equal(calls[0].url, 'https://x.dev/api/devices?status=pending');
    assert.equal(calls[1].url, 'https://x.dev/api/devices/a%2Fb');
    assert.equal(calls[1].method, 'DELETE');
  });

  it('turns a 404 on get into null, and other failures into an explained error', async () => {
    const { impl } = fakeFetch([
      [404, { error: 'no such device' }],
      [401, { error: 'unauthorized' }],
    ]);
    const registry = new DeviceRegistry({ url: 'https://x.dev', token: 'bad', fetchImpl: impl });
    assert.equal(await registry.get('U'), null);
    await assert.rejects(registry.list(), (err) => err instanceof RegistryError && /UPLOAD_TOKEN/.test(err.message));
  });
});

describe('local device discovery', () => {
  it('keeps physical iOS devices from devicectl, with their model', () => {
    const devices = parseDevicectlDevices({
      result: {
        devices: [
          {
            deviceProperties: { name: 'Iphone roro' },
            hardwareProperties: { udid: '00008140-000024A414C1801C', productType: 'iPhone17,3', marketingName: 'iPhone 16', platform: 'iOS', reality: 'physical' },
          },
          {
            deviceProperties: { name: 'Sim' },
            hardwareProperties: { udid: 'X', productType: 'iPhone17,3', platform: 'iOS', reality: 'virtual' },
          },
          {
            deviceProperties: { name: 'Watch' },
            hardwareProperties: { udid: 'Y', productType: 'Watch7,1', platform: 'watchOS', reality: 'physical' },
          },
        ],
      },
    });
    assert.deepEqual(devices, [
      { udid: '00008140-000024A414C1801C', name: 'Iphone roro', product: 'iPhone17,3', model: 'iPhone 16', platform: 'iOS', physical: true },
    ]);
  });

  it("reads this Mac's provisioning UDID, or nothing on an Intel Mac", () => {
    const mac = parseMacHardware({
      SPHardwareDataType: [{ provisioning_UDID: '00006020-0008703A1140C01E', machine_name: 'MacBook Pro', machine_model: 'Mac14,10' }],
    });
    assert.deepEqual(mac, { udid: '00006020-0008703A1140C01E', name: 'MacBook Pro', product: 'Mac14,10' });
    assert.equal(parseMacHardware({ SPHardwareDataType: [{ machine_name: 'MacBook Pro' }] }), null);
  });
});
