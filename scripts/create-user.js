'use strict';

const path = require('path');
const fs = require('fs');
const readline = require('readline');

const config = require('../src/config');
const { UserStore } = require('../src/users');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

/** 隐藏输入的密码询问 */
function askHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let input = '';
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (char) => {
      char = char + '';
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          stdin.removeListener('data', onData);
          stdin.setRawMode(false);
          process.stdout.write('\n');
          resolve(input);
          break;
        case '\u0003':
          stdin.removeListener('data', onData);
          stdin.setRawMode(false);
          process.exit(130);
          break;
        default:
          input += char;
          process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

(async () => {
  const args = process.argv.slice(2);
  const username = args.find((a) => !a.startsWith('-'));
  const force = args.includes('--force');
  const guest = args.includes('--guest') || args.includes('-g');
  if (!username) {
    console.log('用法: node scripts/create-user.js <用户名> [选项]');
    console.log('  --force   重置已有用户的密码');
    console.log('  --guest   创建游客账号（仅可在线查看；默认创建管理员账号）');
    process.exit(1);
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  const store = new UserStore(path.join(config.dataDir, 'users.json'));

  const p1 = await askHidden('请输入密码（至少 8 位）: ');
  const p2 = await askHidden('再次输入密码: ');
  rl.close();

  if (p1 !== p2) {
    console.error('两次输入不一致');
    process.exit(1);
  }
  if (p1.length < 8 || p1.length > 128) {
    console.error('密码长度需为 8-128 位');
    process.exit(1);
  }

  const role = guest ? 'guest' : 'admin';
  const exists = !!store.find(username);
  if (exists && !force) {
    console.error('用户已存在（如需重置密码请加 --force）');
    process.exit(1);
  }
  if (exists) {
    await store.setPassword(username, p1);
    console.log(`已重置用户 ${username}（${role === 'guest' ? '游客' : '管理员'}）的密码`);
  } else {
    await store.create(username, p1, role);
    console.log(`已创建${role === 'guest' ? '游客' : '管理员'}账号 ${username}`);
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
