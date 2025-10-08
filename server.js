require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const auth = require('prismarine-auth');
const WebSocket = require('ws');
const mc = require('minecraft-protocol');
const path = require('path');

const {
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
} = process.env;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

let sessions = {}; // store user sessions in memory

// Step 1: OAuth login URL
app.get('/login', (req, res) => {
    const url =
        `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?` +
        `client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&scope=XboxLive.signin%20offline_access`;
    res.redirect(url);
});

// Step 2: OAuth callback from Microsoft
app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    try {
        // Exchange auth code for token
        const tokenRes = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                code,
                grant_type: "authorization_code",
                redirect_uri: REDIRECT_URI
            })
        });
        const tokenData = await tokenRes.json();

        // Use prismarine-auth to fetch Minecraft profile token
        const mcAuth = await auth.microsoft(tokenData.access_token);

        const sessionId = Math.random().toString(36).slice(2);
        sessions[sessionId] = {
            username: mcAuth.profile.name,
            accessToken: mcAuth.mclc.auth.access_token
        };

        res.send(`<script>
            window.opener.postMessage(${JSON.stringify({ sessionId })}, "*");
            window.close();
        </script>`);
    } catch (err) {
        console.error(err);
        res.status(500).send("Auth failed");
    }
});

// ---------------- WebSocket Proxy ----------------
const wss = new WebSocket.Server({ port: 8080 });
wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
        const data = JSON.parse(msg);
        const { sessionId, host, port } = data;
        const session = sessions[sessionId];

        if (!session) {
            ws.send(JSON.stringify({ error: "Invalid session" }));
            return;
        }

        console.log(`Connecting to ${host}:${port} as ${session.username}`);

        const client = mc.createClient({
            host,
            port,
            username: session.username,
            auth: 'microsoft',
            accessToken: session.accessToken
        });

        client.on('packet', (packet) => ws.send(JSON.stringify(packet)));
        ws.on('message', (msg) => {
            const packet = JSON.parse(msg);
            if (packet.name && packet.data) {
                client.write(packet.name, packet.data);
            }
        });

        client.on('end', () => ws.close());
        client.on('error', (err) => {
            console.error(err);
            ws.close();
        });
    });
});

app.listen(3000, () =>
    console.log('HTTP server running on http://localhost:3000')
);
console.log('WebSocket proxy running on ws://localhost:8080');
