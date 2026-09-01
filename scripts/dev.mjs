import { spawn } from 'node:child_process';

function run(filter) {
  spawn('pnpm', ['--filter', filter, 'dev'], {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
}

run('@craftifai/api');
run('@craftifai/web');
