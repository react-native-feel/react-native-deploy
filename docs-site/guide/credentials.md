# Credentials

Signing assets are **GitHub repository secrets**, sealed against the repository's public key;
GitHub never stores a plaintext value. `rnd credentials` reports which ones exist:

```sh
rnd credentials
```

| Secret | Contents | Used by |
|---|---|---|
| `EAS_IOS_DIST_P12` | base64 `.p12`: distribution certificate **and** its private key | all signed iOS builds |
| `EAS_IOS_P12_PASSWORD` | password for that `.p12` | all signed iOS builds |
| `EAS_IOS_PROFILE` | base64 App Store provisioning profile | `distribution: "store"` |
| `EAS_IOS_PROFILE_INTERNAL` | base64 ad-hoc provisioning profile listing test devices | `distribution: "internal"`, when there is no API key below |
| `EAS_ASC_KEY_ID` / `EAS_ASC_ISSUER_ID` / `EAS_ASC_API_KEY` | App Store Connect API key: id, issuer id, and the `.p8` file's contents | `distribution: "internal"`: registers devices and [generates the ad-hoc profile](/guide/internal-distribution#_3-let-the-build-generate-the-ad-hoc-profile-ios) on each build |
| `EAS_ANDROID_KEYSTORE` | base64 PKCS12 keystore | Android release builds |
| `EAS_ANDROID_STORE_PASSWORD` / `EAS_ANDROID_KEY_ALIAS` / `EAS_ANDROID_KEY_PASSWORD` | keystore details | Android release builds |
| `EAS_INSTALL_TOKEN` | upload token for the [install service](/guide/internal-distribution) | internal builds |

`rnd credentials` does not create or upload these yet. The steps below do it with `asc`,
`openssl` and `gh`.

## iOS

You need an [App Store Connect API key](https://appstoreconnect.apple.com/access/integrations/api)
configured in `asc` (`asc auth login`).

### 1. Register the bundle identifier

```sh
asc bundle-ids create --identifier com.example.myapp --name "My App" --platform IOS
```

Note the `id` in the response (for example `B4ZA7LF68K`): profiles refer to the bundle id by it.

### 2. Create a distribution certificate

Generate the private key yourself, so it never has to come out of a keychain:

```sh
openssl genrsa -out dist.key 2048
openssl req -new -key dist.key -out dist.csr -subj "/CN=My App distribution/C=US"
asc certificates create --certificate-type IOS_DISTRIBUTION --csr dist.csr --output json > cert.json
python3 -c 'import json,base64; d=json.load(open("cert.json"))["data"]; open("dist.cer","wb").write(base64.b64decode(d["attributes"]["certificateContent"])); print(d["id"])'
```

The last line prints the certificate id. Apple allows only a few distribution certificates per
account, so reuse one across apps.

::: tip Why not export from Keychain Access?
`security export` exports every identity in the keychain and asks for the login-keychain password
once per private key. Generating a fresh key needs no prompts at all.
:::

### 3. Package it as a .p12

```sh
openssl x509 -inform DER -in dist.cer -out dist.pem
openssl rand -hex 16 > p12pass
openssl pkcs12 -export -inkey dist.key -in dist.pem -out dist.p12 -passout file:p12pass \
  -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1
```

::: warning Use the legacy encryption flags
OpenSSL 3 encrypts `.p12` files with AES by default, and macOS `security import` on the runner
rejects them. The three `-certpbe` / `-keypbe` / `-macalg` flags produce one it accepts.
:::

### 4. Create the App Store profile

```sh
asc profiles create --bundle <bundle-id-resource-id> --certificate <certificate-id> \
  --profile-type IOS_APP_STORE --name "My App AppStore" --output json \
  | python3 -c 'import json,sys,base64; d=json.load(sys.stdin)["data"]; open("appstore.mobileprovision","wb").write(base64.b64decode(d["attributes"]["profileContent"]))'
```

For internal builds, add the App Store Connect API key secrets and the build generates the
ad-hoc profile from your registered devices: see
[Internal distribution](/guide/internal-distribution#_3-let-the-build-generate-the-ad-hoc-profile-ios).

### 5. Store the secrets

```sh
base64 -i dist.p12 | gh secret set EAS_IOS_DIST_P12
gh secret set EAS_IOS_P12_PASSWORD < p12pass
base64 -i appstore.mobileprovision | gh secret set EAS_IOS_PROFILE
rnd credentials -p ios
```

Keep `dist.key` somewhere safe (a password manager), and delete the working files.

### How the runner uses them

The `.p12` goes into a throwaway keychain in `$RUNNER_TEMP`, never the login keychain, and is
deleted in an `always()` step. The workflow reads the profile's UUID, team and bundle id from
the profile itself and applies manual signing **only to the target that builds that bundle id**.
Setting it globally would also hit CocoaPods resource bundles, which `xcodebuild` rejects.

One profile per build means app extensions (widgets, notification services) are not signed yet.

## Android

```sh
keytool -genkeypair -v -storetype PKCS12 -keystore release.keystore \
  -alias upload -keyalg RSA -keysize 2048 -validity 10000

base64 -i release.keystore | gh secret set EAS_ANDROID_KEYSTORE
gh secret set EAS_ANDROID_STORE_PASSWORD     # prompts
gh secret set EAS_ANDROID_KEY_ALIAS --body upload
gh secret set EAS_ANDROID_KEY_PASSWORD       # prompts
```

The runner passes the keystore to Gradle through `-Pandroid.injected.signing.*`, so your Gradle
files are never edited. Without a keystore, release builds are signed with the debug key.

::: danger Back up the keystore
It is the only thing that can sign updates to a published Google Play listing.
:::
