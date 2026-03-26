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

function handleRequest(req, res) {
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

  const users = loadJson('users.json');
  const routeMatch = pathname.match(
    /^\/api\/users\/([^/]+)\/(reliability|transactions|transaction-events|cashflow)$/,
  );

  if (!routeMatch) {
    sendError(res, 404, `Route '${pathname}' not found`);
    return;
  }

  const [, rawUserId, resource] = routeMatch;
  const userId = decodeURIComponent(rawUserId);

  if (!validateUser(res, userId, users)) {
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

    const transactions = [
      ...loadJson('transactions.json'),
      ...loadJson('transactions.large.json'),
    ];

    sendJson(res, 200, filterTransactions(transactions, userId, from, to));
    return;
  }

  if (resource === 'transaction-events') {
    const eventEntries = loadJson('transaction-events.json');
    const userEvents = eventEntries
      .filter((entry) => entry.user_id === userId)
      .map(stripUserId);

    sendJson(res, 200, userEvents);
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
    return;
  }
}

export function createAppServer() {
  return createServer(handleRequest);
}

if (process.argv[1] === currentFilePath) {
  const server = createAppServer();

  server.listen(port, host, () => {
    console.log(`Reliability mock server listening on http://${host}:${port}`);
  });
}
