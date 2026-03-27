import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(__dirname, '..');
const dataDir = join(rootDir, 'data');
const host = process.env.HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '3004', 10);
const eventIntervalMs = Number.parseInt(process.env.TRANSACTION_EVENT_INTERVAL_MS ?? '4000', 10);
const heartbeatIntervalMs = Number.parseInt(process.env.SSE_HEARTBEAT_INTERVAL_MS ?? '15000', 10);

const mockMerchants = ['BVG', 'Edeka', 'Spotify', 'Rewe', 'Rossmann', 'Decathlon'];
const mockCategories = ['TRANSPORT', 'GROCERIES', 'ENTERTAINMENT', 'HEALTH', 'SHOPPING'];
const mockAccounts = ['Checking', 'Savings', 'Credit Card'];

function loadJson(fileName) {
  const filePath = join(dataDir, fileName);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body, null, 2));
}

function sendError(res, statusCode, message, details) {
  sendJson(res, statusCode, {
    error: message,
    ...(details ? { details } : {}),
  });
}

function sendSseHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

function writeSseEvent(res, { event, id, data }) {
  if (id !== undefined) {
    res.write(`id: ${id}\n`);
  }

  if (event) {
    res.write(`event: ${event}\n`);
  }

  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  for (const line of payload.split('\n')) {
    res.write(`data: ${line}\n`);
  }

  res.write('\n');
}

function writeSseComment(res, comment) {
  res.write(`: ${comment}\n\n`);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function stripUserId(record) {
  const { user_id: _userId, ...rest } = record;
  return rest;
}

function compareDateStrings(a, b) {
  return a.localeCompare(b);
}

function ensureUserExists(userId, users) {
  return users.some((user) => user.id === userId);
}

function parseRequest(req) {
  return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
}

function validateUser(res, userId, users) {
  if (!ensureUserExists(userId, users)) {
    sendError(res, 404, `Unknown user '${userId}'`);
    return false;
  }

  return true;
}

function validateDateParam(res, name, value) {
  if (!value) {
    sendError(res, 400, `Missing required query parameter '${name}'`);
    return false;
  }

  if (!isIsoDate(value)) {
    sendError(res, 400, `Invalid date format for '${name}'`, 'Expected YYYY-MM-DD');
    return false;
  }

  return true;
}

function filterTransactions(transactions, userId, from, to) {
  return transactions
    .filter((transaction) => transaction.user_id === userId)
    .filter((transaction) => compareDateStrings(transaction.date, from) >= 0)
    .filter((transaction) => compareDateStrings(transaction.date, to) <= 0)
    .map(stripUserId);
}

function filterCashflow(cashflowEntries, userId, from, to) {
  const months = cashflowEntries
    .filter((entry) => entry.user_id === userId)
    .filter((entry) => compareDateStrings(entry.month, from.slice(0, 7)) >= 0)
    .filter((entry) => compareDateStrings(entry.month, to.slice(0, 7)) <= 0)
    .map(stripUserId);

  return {
    user_id: userId,
    from,
    to,
    months,
  };
}

function createInitialState() {
  const users = loadJson('users.json');
  const transactions = [...loadJson('transactions.json'), ...loadJson('transactions.large.json')];
  const clientsByUser = new Map();
  const transactionsByUser = new Map(users.map((user) => [user.id, []]));

  let maxGeneratedId = 0;

  for (const transaction of transactions) {
    if (!transactionsByUser.has(transaction.user_id)) {
      transactionsByUser.set(transaction.user_id, []);
    }

    transactionsByUser.get(transaction.user_id).push({ ...transaction });

    const generatedIdMatch = transaction.id.match(/^txn_evt_(\d+)$/);
    if (generatedIdMatch) {
      maxGeneratedId = Math.max(maxGeneratedId, Number.parseInt(generatedIdMatch[1], 10));
    }
  }

  return {
    users,
    clientsByUser,
    transactionsByUser,
    nextEventId: 1,
    nextTransactionId: maxGeneratedId + 1,
  };
}

function registerClient(state, userId, res) {
  const userClients = state.clientsByUser.get(userId) ?? new Set();
  userClients.add(res);
  state.clientsByUser.set(userId, userClients);

  const cleanup = () => {
    const currentClients = state.clientsByUser.get(userId);
    if (!currentClients) {
      return;
    }

    currentClients.delete(res);
    if (currentClients.size === 0) {
      state.clientsByUser.delete(userId);
    }
  };

  res.on('close', cleanup);
  res.on('error', cleanup);
}

function broadcastToUser(state, userId, payload) {
  const clients = state.clientsByUser.get(userId);
  if (!clients || clients.size === 0) {
    return;
  }

  const eventId = state.nextEventId++;
  for (const client of clients) {
    writeSseEvent(client, {
      event: 'transaction',
      id: eventId,
      data: payload,
    });
  }
}

function sendHeartbeat(state) {
  for (const clients of state.clientsByUser.values()) {
    for (const client of clients) {
      writeSseComment(client, 'keepalive');
    }
  }
}

function pickRandomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function createAddedTransaction(state, userId, userTransactions) {
  const previousBalance = userTransactions.at(-1)?.balance ?? 1000;
  const amount = Number((Math.random() * 85 + 5).toFixed(2)) * (Math.random() < 0.8 ? -1 : 1);
  const transaction = {
    user_id: userId,
    id: `txn_evt_${state.nextTransactionId++}`,
    date: getTodayIsoDate(),
    amount,
    merchant: pickRandomItem(mockMerchants),
    category: pickRandomItem(mockCategories),
    account: pickRandomItem(mockAccounts),
    balance: Number((previousBalance + amount).toFixed(2)),
  };

  userTransactions.push(transaction);

  return {
    type: 'TRANSACTION_ADDED',
    transaction: stripUserId(transaction),
  };
}

function createUpdatedTransaction(userTransactions) {
  const transaction = pickRandomItem(userTransactions);
  const nextBalance = Number((transaction.balance + (Math.random() * 40 - 20)).toFixed(2));
  transaction.balance = nextBalance;

  return {
    type: 'TRANSACTION_UPDATED',
    transaction_id: transaction.id,
    balance: nextBalance,
  };
}

function createDeletedTransaction(userTransactions) {
  const transactionIndex = Math.floor(Math.random() * userTransactions.length);
  const [transaction] = userTransactions.splice(transactionIndex, 1);

  return {
    type: 'TRANSACTION_DELETED',
    transaction_id: transaction.id,
  };
}

function generateTransactionEvent(state) {
  const usersWithTransactions = state.users.filter((user) => {
    const transactions = state.transactionsByUser.get(user.id) ?? [];
    return transactions.length > 0;
  });
  const targetUser =
    usersWithTransactions.length > 0 && Math.random() < 0.7
      ? pickRandomItem(usersWithTransactions)
      : pickRandomItem(state.users);
  const userTransactions = state.transactionsByUser.get(targetUser.id) ?? [];

  let payload;
  if (userTransactions.length === 0) {
    payload = createAddedTransaction(state, targetUser.id, userTransactions);
  } else {
    const action = pickRandomItem(['add', 'update', 'delete']);

    if (action === 'add') {
      payload = createAddedTransaction(state, targetUser.id, userTransactions);
    } else if (action === 'update') {
      payload = createUpdatedTransaction(userTransactions);
    } else {
      payload = createDeletedTransaction(userTransactions);
    }
  }

  state.transactionsByUser.set(targetUser.id, userTransactions);
  broadcastToUser(state, targetUser.id, payload);
}

function createRequestHandler(state) {
  return function handleRequest(req, res) {
    if (!req.url || !req.method) {
      sendError(res, 400, 'Malformed request');
      return;
    }

    const url = parseRequest(req);
    const pathname = url.pathname;

    if (req.method !== 'GET') {
      sendError(res, 405, 'Method not allowed');
      return;
    }

    if (pathname === '/' || pathname === '/health') {
      sendJson(res, 200, {
        service: 'reliability-explorer-mock-server',
        status: 'ok',
        port,
        endpoints: [
          '/api/users/:userId/reliability?from=YYYY-MM-DD',
          '/api/users/:userId/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD',
          '/api/users/:userId/transaction-events',
          '/api/users/:userId/cashflow?from=YYYY-MM-DD&to=YYYY-MM-DD',
        ],
      });
      return;
    }

    const routeMatch = pathname.match(
      /^\/api\/users\/([^/]+)\/(reliability|transactions|transaction-events|cashflow)$/,
    );

    if (!routeMatch) {
      sendError(res, 404, `Route '${pathname}' not found`);
      return;
    }

    const [, rawUserId, resource] = routeMatch;
    const userId = decodeURIComponent(rawUserId);

    if (!validateUser(res, userId, state.users)) {
      return;
    }

    if (resource === 'reliability') {
      const from = url.searchParams.get('from');

      if (!validateDateParam(res, 'from', from)) {
        return;
      }

      const reliabilityEntries = loadJson('reliability.json');
      const result = reliabilityEntries.find(
        (entry) => entry.user_id === userId && entry.from === from,
      );

      if (!result) {
        sendError(res, 404, `No reliability data found for user '${userId}' and from '${from}'`);
        return;
      }

      sendJson(res, 200, result);
      return;
    }

    if (resource === 'transactions') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');

      if (!validateDateParam(res, 'from', from) || !validateDateParam(res, 'to', to)) {
        return;
      }

      if (compareDateStrings(from, to) > 0) {
        sendError(res, 400, "'from' must be less than or equal to 'to'");
        return;
      }

      const transactions = state.transactionsByUser.get(userId) ?? [];
      sendJson(res, 200, filterTransactions(transactions, userId, from, to));
      return;
    }

    if (resource === 'transaction-events') {
      sendSseHeaders(res);
      writeSseEvent(res, {
        event: 'connected',
        id: state.nextEventId++,
        data: {
          userId,
          connectedAt: new Date().toISOString(),
        },
      });
      registerClient(state, userId, res);
      return;
    }

    if (resource === 'cashflow') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');

      if (!validateDateParam(res, 'from', from) || !validateDateParam(res, 'to', to)) {
        return;
      }

      if (compareDateStrings(from, to) > 0) {
        sendError(res, 400, "'from' must be less than or equal to 'to'");
        return;
      }

      const cashflowEntries = loadJson('cashflow.json');
      sendJson(res, 200, filterCashflow(cashflowEntries, userId, from, to));
    }
  };
}

export function createAppServer() {
  const state = createInitialState();
  const server = createServer(createRequestHandler(state));

  const eventTimer = setInterval(() => {
    generateTransactionEvent(state);
  }, eventIntervalMs);
  eventTimer.unref();

  const heartbeatTimer = setInterval(() => {
    sendHeartbeat(state);
  }, heartbeatIntervalMs);
  heartbeatTimer.unref();

  server.on('close', () => {
    clearInterval(eventTimer);
    clearInterval(heartbeatTimer);
  });

  return server;
}

if (process.argv[1] === currentFilePath) {
  const server = createAppServer();

  server.listen(port, host, () => {
    console.log(`Reliability mock server listening on http://${host}:${port}`);
  });
}
