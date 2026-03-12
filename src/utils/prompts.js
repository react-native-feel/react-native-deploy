import inquirer from 'inquirer';

export async function ask(question) {
  const { answer } = await inquirer.prompt([{
    ...question,
    name: 'answer',
  }]);
  return answer;
}

export async function confirm(message, defaultVal = true) {
  return ask({ type: 'confirm', message, default: defaultVal });
}

export async function input(message, defaultVal) {
  return ask({ type: 'input', message, default: defaultVal });
}

export async function select(message, choices) {
  return ask({ type: 'list', message, choices });
}

export async function password(message) {
  return ask({ type: 'password', message, mask: '*' });
}
