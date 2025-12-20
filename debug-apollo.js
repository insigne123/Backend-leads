const fs = require('fs');
const https = require('https');

// Read .env.local to find APOLLO_API_KEY
let apiKey = '';
try {
    const envFile = fs.readFileSync('.env.local', 'utf8');
    const match = envFile.match(/APOLLO_API_KEY=(.+)/);
    if (match && match[1]) {
        apiKey = match[1].trim();
    }
} catch (err) {
    console.error('Could not read .env.local', err);
    process.exit(1);
}

if (!apiKey) {
    console.error('APOLLO_API_KEY not found in .env.local');
    process.exit(1);
}

console.log('Using API Key:', apiKey.substring(0, 5) + '...');

const payload = {
    api_key: apiKey,
    first_name: "Satya",
    last_name: "Nadella",
    domain: "microsoft.com",
    reveal_personal_emails: true,
    reveal_phone_number: true
};

const options = {
    hostname: 'api.apollo.io',
    path: '/v1/people/match',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey
    }
};

const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log('--- STATUS ---');
        console.log(res.statusCode);
        console.log('--- RESPONSE ---');
        try {
            const json = JSON.parse(data);
            console.log(JSON.stringify(json, null, 2));
        } catch (e) {
            console.log(data);
        }
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.write(JSON.stringify(payload));
req.end();
