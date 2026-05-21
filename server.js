import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import {
    DescribeStreamCommand,
    GetRecordsCommand,
    GetShardIteratorCommand,
    KinesisClient,
} from '@aws-sdk/client-kinesis';
import {
    AthenaClient,
    GetQueryExecutionCommand,
    GetQueryResultsCommand,
    StartQueryExecutionCommand,
} from '@aws-sdk/client-athena';

dotenv.config();

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1";
const STREAM_NAME = process.env.KINESIS_STREAM_NAME || process.env.AWS_KINESIS_STREAM_NAME;
const PORT = process.env.PORT || 5000;
const kinesisClient = new KinesisClient({ region: REGION });
const athenaClient = new AthenaClient({ region: REGION });

const app = express();
app.use(express.json());
app.use(cors());

// Fetch URI and Secret from .env (with fallbacks if running in an environment without them)
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:1234@agamin-db.v9iydl5.mongodb.net/?appName=Agamin-DB";
const JWT_SECRET = process.env.JWT_SECRET || "default_agamin_secret";
const KINESIS_POLL_MS = Number(process.env.KINESIS_POLL_MS || 1000);
const KINESIS_LIMIT = Number(process.env.KINESIS_LIMIT || 100);
const ATHENA_DATABASE = process.env.ATHENA_DATABASE;
const ATHENA_TABLE = process.env.ATHENA_TABLE;
const ATHENA_OUTPUT_LOCATION = process.env.ATHENA_OUTPUT_LOCATION;
const ATHENA_WORKGROUP = process.env.ATHENA_WORKGROUP || "primary";
const ATHENA_TIMESTAMP_COLUMN = process.env.ATHENA_TIMESTAMP_COLUMN || "timestamp";
const ATHENA_COIN_ID_COLUMN = process.env.ATHENA_COIN_ID_COLUMN || "coin_id";
const ATHENA_PRICE_COLUMN = process.env.ATHENA_PRICE_COLUMN || "price";
const ATHENA_VOLUME_COLUMN = process.env.ATHENA_VOLUME_COLUMN || "volume";

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

let connectedClients = [];
let realtimeStatus = {
    enabled: Boolean(STREAM_NAME),
    streamName: STREAM_NAME || null,
    region: REGION,
    connectedClients: 0,
    lastRecordAt: null,
    lastError: null,
};
let latestCryptoPayload = [];

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Cloud MongoDB Connected!"))
    .catch(err => console.error("❌ MongoDB Error:", err));

// Database Structure
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // Added password field
    bookmarks: [String],
    alerts: [{ id: String, value: Number }]
});
const User = mongoose.model('User', UserSchema);

const sendJson = (client, payload) => {
    if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(payload));
    }
};

const broadcast = (payload) => {
    const message = JSON.stringify(payload);
    connectedClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
};

const parseKinesisRecord = (record) => {
    try {
        const text = Buffer.from(record.Data).toString('utf8');
        console.log("New Kinesis Record received:", text);
        return JSON.parse(text);
    } catch (error) {
        console.error("Failed to parse Kinesis record:", error.message);
        return null;
    }
};

const normalizeCryptoPayload = (records) => {
    const parsedRecords = records
        .map(parseKinesisRecord)
        .filter(Boolean);

    if (!parsedRecords.length) return null;

    const coins = parsedRecords.flatMap((record) => {
        if (Array.isArray(record)) return record;
        if (Array.isArray(record.coins)) return record.coins;
        if (record.data && Array.isArray(record.data)) return record.data;
        if (record.id || record.symbol) return [record];
        return [];
    });

    return coins.length ? coins : parsedRecords;
};

const quoteIdentifier = (identifier) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
        throw new Error(`Invalid Athena identifier: ${identifier}`);
    }

    return `"${identifier}"`;
};

const escapeSqlString = (value) => String(value).replaceAll("'", "''");

const waitForAthenaQuery = async (queryExecutionId) => {
    while (true) {
        const execution = await athenaClient.send(new GetQueryExecutionCommand({
            QueryExecutionId: queryExecutionId,
        }));

        const status = execution.QueryExecution?.Status;
        const state = status?.State;

        if (state === "SUCCEEDED") return;
        if (state === "FAILED" || state === "CANCELLED") {
            throw new Error(status?.StateChangeReason || `Athena query ${state?.toLowerCase()}`);
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
};

const getAthenaChartData = async ({ coinId, symbol, days }) => {
    if (!ATHENA_DATABASE || !ATHENA_TABLE || !ATHENA_OUTPUT_LOCATION) {
        throw new Error("Athena chart API is not configured. Set ATHENA_DATABASE, ATHENA_TABLE, and ATHENA_OUTPUT_LOCATION.");
    }

    const safeDays = Math.max(1, Math.min(Number(days) || 7, 365));
    const coinKey = symbol || coinId;
    const timestampExpr = `try_cast(${quoteIdentifier(ATHENA_TIMESTAMP_COLUMN)} AS timestamp)`;
    const query = `
        SELECT
            ${timestampExpr} AS ts,
            CAST(${quoteIdentifier(ATHENA_PRICE_COLUMN)} AS double) AS price,
            CAST(${quoteIdentifier(ATHENA_VOLUME_COLUMN)} AS double) AS volume
        FROM ${quoteIdentifier(ATHENA_DATABASE)}.${quoteIdentifier(ATHENA_TABLE)}
        WHERE lower(CAST(${quoteIdentifier(ATHENA_COIN_ID_COLUMN)} AS varchar)) = lower('${escapeSqlString(coinKey)}')
          AND ${timestampExpr} >= current_timestamp - interval '${safeDays}' day
        ORDER BY ${timestampExpr} ASC
    `;

    const started = await athenaClient.send(new StartQueryExecutionCommand({
        QueryString: query,
        QueryExecutionContext: {
            Database: ATHENA_DATABASE,
        },
        ResultConfiguration: {
            OutputLocation: ATHENA_OUTPUT_LOCATION,
        },
        WorkGroup: ATHENA_WORKGROUP,
    }));

    const queryExecutionId = started.QueryExecutionId;
    await waitForAthenaQuery(queryExecutionId);

    const prices = [];
    const totalVolumes = [];
    let nextToken;

    do {
        const results = await athenaClient.send(new GetQueryResultsCommand({
            QueryExecutionId: queryExecutionId,
            NextToken: nextToken,
        }));

        for (const [index, row] of (results.ResultSet?.Rows || []).entries()) {
            if (!nextToken && index === 0) continue;

            const [timeCell, priceCell, volumeCell] = row.Data || [];
            const timestamp = new Date(timeCell?.VarCharValue).getTime();
            const price = Number(priceCell?.VarCharValue);
            const volume = Number(volumeCell?.VarCharValue || 0);

            if (Number.isFinite(timestamp) && Number.isFinite(price)) {
                prices.push([timestamp, price]);
                totalVolumes.push([timestamp, Number.isFinite(volume) ? volume : 0]);
            }
        }

        nextToken = results.NextToken;
    } while (nextToken);

    return {
        prices,
        total_volumes: totalVolumes,
        source: "athena",
        queryExecutionId,
    };
};

wss.on('connection', (ws) => {
    console.log('React frontend connected via WebSocket');
    connectedClients.push(ws);
    realtimeStatus.connectedClients = connectedClients.length;

    sendJson(ws, {
        type: 'realtime:status',
        data: realtimeStatus,
    });

    if (latestCryptoPayload.length) {
        sendJson(ws, {
            type: 'crypto:update',
            data: latestCryptoPayload,
            source: 'kinesis-cache',
            receivedAt: realtimeStatus.lastRecordAt,
        });
    }

    ws.on('close', () => {
        connectedClients = connectedClients.filter(client => client !== ws);
        realtimeStatus.connectedClients = connectedClients.length;
        console.log('React frontend disconnected');
    });
});

const publishCryptoUpdate = (coins, source = 'kinesis') => {
    latestCryptoPayload = coins;
    realtimeStatus.lastRecordAt = new Date().toISOString();
    realtimeStatus.lastError = null;

    broadcast({
        type: 'crypto:update',
        data: coins,
        source,
        receivedAt: realtimeStatus.lastRecordAt,
    });
};

const startKinesisConsumer = async () => {
    if (!STREAM_NAME) {
        console.log("AWS Kinesis consumer disabled. Set KINESIS_STREAM_NAME to stream realtime crypto data.");
        return;
    }

    try {
        const description = await kinesisClient.send(new DescribeStreamCommand({ StreamName: STREAM_NAME }));
        const shards = description.StreamDescription?.Shards || [];

        if (!shards.length) {
            console.log(`Kinesis stream ${STREAM_NAME} has no open shards to poll.`);
            return;
        }

        console.log(`Successfully connected to Kinesis Stream: ${STREAM_NAME}. Polling ${shards.length} shard(s) for data...`);

        await Promise.all(shards.map(async (shard) => {
            const iteratorResponse = await kinesisClient.send(new GetShardIteratorCommand({
                StreamName: STREAM_NAME,
                ShardId: shard.ShardId,
                ShardIteratorType: 'LATEST',
            }));

            let shardIterator = iteratorResponse.ShardIterator;

            while (shardIterator) {
                try {
                    const recordsResponse = await kinesisClient.send(new GetRecordsCommand({
                        ShardIterator: shardIterator,
                        Limit: KINESIS_LIMIT,
                    }));

                    shardIterator = recordsResponse.NextShardIterator;

                    if (recordsResponse.Records && recordsResponse.Records.length > 0) {
                        const coins = normalizeCryptoPayload(recordsResponse.Records);
                        if (coins) publishCryptoUpdate(coins);
                    }
                } catch (error) {
                    realtimeStatus.lastError = error.message;
                    console.error("Kinesis polling error:", error.message);
                    await new Promise((resolve) => setTimeout(resolve, 5000));
                }

                await new Promise((resolve) => setTimeout(resolve, KINESIS_POLL_MS));
            }
        }));
    } catch (error) {
        realtimeStatus.enabled = false;
        realtimeStatus.lastError = error.message;
        console.error("Error in Kinesis consumer pipeline:", error);
    }
};

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ message: "Access Denied. No token provided." });

    const token = authHeader.split(" ")[1]; // Format: "Bearer <token>"
    if (!token) return res.status(401).json({ message: "Access Denied. Invalid token format." });

    try {
        const verified = jwt.verify(token, JWT_SECRET);
        req.user = verified;
        next();
    } catch {
        res.status(400).json({ message: "Invalid or expired token" });
    }
};

// --- AUTHENTICATION ROUTES ---

// 1. Register a new user
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ message: "Username and password are required" });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ message: "Username already exists" });

        // Hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create new user
        const newUser = new User({
            username,
            password: hashedPassword,
            bookmarks: [],
            alerts: []
        });

        await newUser.save();
        res.status(201).json({ message: "User registered successfully" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// 2. Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: "Username and password are required" });
        }

        // Check if user exists
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ message: "Invalid username or password" });

        // Validate password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ message: "Invalid username or password" });

        // Create and assign a token
        const token = jwt.sign(
            { _id: user._id, username: user.username }, 
            JWT_SECRET, 
            { expiresIn: '7d' } // Token expires in 7 days
        );
        
        res.status(200).json({ 
            message: "Logged in successfully",
            token,
            user: { username: user.username, bookmarks: user.bookmarks, alerts: user.alerts }
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// --- PROTECTED ROUTES (Requires Login) ---

// 3. Save or Update User Data (Bookmarks & Alerts)
app.post('/api/save', verifyToken, async (req, res) => {
    // We use req.user.username from the verified token to ensure users only edit their own data
    const username = req.user.username; 
    const { bookmarks, alerts } = req.body;
    
    try {
        let user = await User.findOneAndUpdate(
            { username },
            { bookmarks, alerts },
            { new: true, upsert: true } // upsert ensures fallback creation if missing somehow
        );
        res.status(200).json({ message: "Data synced successfully", user: { bookmarks: user.bookmarks, alerts: user.alerts }});
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// 4. Load current user's profile
app.get('/api/user/me', verifyToken, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.user.username });
        if (!user) return res.status(404).json({ message: "User not found" });
        
        res.status(200).json({ username: user.username, bookmarks: user.bookmarks, alerts: user.alerts });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Realtime pipeline status for the React app and deployment health checks.
app.get('/api/realtime/status', (req, res) => {
    res.status(200).json(realtimeStatus);
});

app.get('/api/coins/:coinId/history', async (req, res) => {
    try {
        const data = await getAthenaChartData({
            coinId: req.params.coinId,
            symbol: req.query.symbol,
            days: req.query.days,
        });

        res.status(200).json(data);
    } catch (error) {
        console.error("Athena chart query error:", error.message);
        res.status(503).json({
            message: "Historical chart data is unavailable",
            error: error.message,
        });
    }
});

// Add a public health check route to verify server is running
app.get('/', (req, res) => {
    res.send('🚀 Agamin Crypto Backend is running!');
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startKinesisConsumer();
});
