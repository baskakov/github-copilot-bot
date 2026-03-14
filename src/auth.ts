/**
 * GitHub Device Flow authentication for GitHub Copilot.
 * This obtains an OAuth token using the same OAuth App that VS Code Copilot uses,
 * which gives access to the full Copilot model catalog.
 *
 * Run once with:  npx ts-node src/auth.ts
 * Then paste the printed token into your .env as GITHUB_TOKEN=
 */

import https from 'https';
import fs from 'fs';
import path from 'path';

// GitHub Copilot OAuth App client ID (same one used by VS Code extension)
const CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const SCOPES = 'read:user';

function httpsPost(hostname: string, path: string, body: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'GitHubCopilotChat/0.22.4',
          'Content-Length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(hostname: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'GitHubCopilotChat/0.22.4', ...headers },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('🔑 GitHub Copilot OAuth Device Flow\n');

  // Step 1: Request device & user codes
  const deviceRes = await httpsPost(
    'github.com',
    '/login/device/code',
    `client_id=${CLIENT_ID}&scope=${SCOPES}`
  );
  const deviceData = JSON.parse(deviceRes.body) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };

  if (!deviceData.device_code) {
    console.error('❌ Failed to get device code:', deviceRes.body);
    process.exit(1);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  1. Open: ${deviceData.verification_uri}`);
  console.log(`  2. Enter code: ${deviceData.user_code}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Waiting for you to authorize...');

  // Step 2: Poll for token
  const interval = (deviceData.interval ?? 5) * 1000;
  const expiresAt = Date.now() + deviceData.expires_in * 1000;
  let accessToken: string | null = null;

  while (Date.now() < expiresAt) {
    await sleep(interval);
    const pollRes = await httpsPost(
      'github.com',
      '/login/oauth/access_token',
      `client_id=${CLIENT_ID}&device_code=${deviceData.device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code`
    );
    const pollData = JSON.parse(pollRes.body) as {
      access_token?: string;
      error?: string;
    };

    if (pollData.access_token) {
      accessToken = pollData.access_token;
      break;
    }
    if (pollData.error === 'slow_down') {
      await sleep(5000);
    } else if (pollData.error && pollData.error !== 'authorization_pending') {
      console.error('❌ Auth error:', pollData.error);
      process.exit(1);
    }
    process.stdout.write('.');
  }

  if (!accessToken) {
    console.error('\n❌ Timed out waiting for authorization.');
    process.exit(1);
  }

  console.log('\n\n✅ Authorized!\n');

  // Step 3: Verify it works with Copilot
  const copilotRes = await httpsGet('api.github.com', '/copilot_internal/v2/token', {
    Authorization: `Bearer ${accessToken}`,
  });
  if (copilotRes.status === 200) {
    console.log('✅ Copilot token exchange: OK');
  } else {
    console.log(`⚠️  Copilot token exchange returned ${copilotRes.status}: ${copilotRes.body.slice(0, 200)}`);
    console.log('   The token is still valid for GitHub Models API.');
  }

  // Step 4: Write to .env
  const envPath = path.resolve(__dirname, '../.env');
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

  if (envContent.match(/^GITHUB_TOKEN=.*/m)) {
    envContent = envContent.replace(/^GITHUB_TOKEN=.*/m, `GITHUB_TOKEN=${accessToken}`);
  } else {
    envContent += `\nGITHUB_TOKEN=${accessToken}\n`;
  }

  fs.writeFileSync(envPath, envContent);
  console.log(`\n✅ Token saved to .env`);
  console.log(`   GITHUB_TOKEN=${accessToken.slice(0, 20)}...`);
  console.log('\nYou can now run: npm run dev');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});


