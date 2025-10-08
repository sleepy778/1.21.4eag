const express = require('express');
const auth = require('prismarine-auth');
const WebSocket = require('ws');
const mc = require('minecraft-protocol');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ---------------- Microsoft / Minecraft OAuth ----------------
app.post('/login', async (req, res) => {
    const { code } = req.body; // OAuth code from browser
    try {
        // prismarine-auth handles Microsoft -> Xbox -> XSTS -> Minecraft token
        const result = await auth.microsoft(code);
        // result contains { access_token, refresh_token, client_token, selectedProfile, etc. }
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send('Auth failed');
    }
});

// ---------------- WebSocket Proxy ----------------
const wss = new WebSocket.Server({ port: 8080 });
wss.on('connection', (ws) => {
    ws.on('message', async (msg) => {
        const data = JSON.parse(msg);
        const { host, port, username, token } = data;

        console.log(`Connecting to ${host}:${port} as ${username}`);

        // Connect to Minecraft server using node-minecraft-protocol
        const client = mc.createClient({
            host,
            port,
            username,
            auth: 'microsoft',
            accessToken: token
        });

        // Forward packets from Minecraft server to browser
        client.on('packet', (packet) => {
            ws.send(JSON.stringify(packet));
        });

        // Forward packets from browser to Minecraft server
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

app.listen(3000, () => console.log('HTTP server running on http://localhost:3000'));
console.log('WebSocket proxy running on ws://localhost:8080');
