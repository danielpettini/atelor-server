const assert = require("node:assert/strict");
const { once } = require("node:events");
const test = require("node:test");
const mongoose = require("mongoose");

const {
  activeExpirationFilter,
  createApp,
  resolveAllowedOrigins,
} = require("../app");
const { normalizeMachineId } = require("../validation");

const LICENSE_KEY = "ATELOR-TEST-0001";
const MACHINE_A = "a".repeat(64);
const MACHINE_B = "b".repeat(64);
const LEGACY_MACHINE = "pc-abcdefghijk";
const UPDATE_METADATA = Object.freeze({
  version: "1.0.3",
  sha256: "c".repeat(64),
  size: 123456,
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function valuesEqual(left, right) {
  if (left instanceof Date || right instanceof Date) {
    return new Date(left).getTime() === new Date(right).getTime();
  }
  return left === right;
}

function matchesCondition(actual, condition, hasProperty) {
  if (
    condition &&
    typeof condition === "object" &&
    !Array.isArray(condition) &&
    !(condition instanceof Date)
  ) {
    return Object.entries(condition).every(([operator, expected]) => {
      if (operator === "$exists") return hasProperty === expected;
      if (operator === "$gt") {
        return new Date(actual).getTime() > new Date(expected).getTime();
      }
      throw new Error(`Operador de teste não implementado: ${operator}`);
    });
  }
  return valuesEqual(actual, condition);
}

function matchesFilter(document, filter) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === "$and") {
      return condition.every((part) => matchesFilter(document, part));
    }
    if (key === "$or") {
      return condition.some((part) => matchesFilter(document, part));
    }
    return matchesCondition(
      document[key],
      condition,
      Object.prototype.hasOwnProperty.call(document, key),
    );
  });
}

function applyUpdate(document, update) {
  if (update.$set) Object.assign(document, clone(update.$set));
  if (update.$push) {
    for (const [field, operation] of Object.entries(update.$push)) {
      const current = Array.isArray(document[field]) ? document[field] : [];
      current.push(...clone(operation.$each));
      document[field] = operation.$slice
        ? current.slice(operation.$slice)
        : current;
    }
  }
}

function createFakeLicenseModel(initialLicenses) {
  const licenses = initialLicenses.map((license, index) => ({
    _id: license._id ?? `license-${index + 1}`,
    ativo: true,
    plano: "PRO",
    expiracao: null,
    id_maquina: null,
    historico_ativacoes: [],
    ...clone(license),
  }));
  let updateCount = 0;

  return {
    findOne(filter) {
      return Promise.resolve(clone(licenses.find((item) => matchesFilter(item, filter))));
    },
    async findOneAndUpdate(filter, update) {
      const license = licenses.find((item) => matchesFilter(item, filter));
      if (!license) return null;
      updateCount += 1;
      applyUpdate(license, update);
      return clone(license);
    },
    get(licenseKey = LICENSE_KEY) {
      return clone(licenses.find((item) => item.licenseKey === licenseKey));
    },
    get updateCount() {
      return updateCount;
    },
  };
}

function baseLicense(overrides = {}) {
  return {
    licenseKey: LICENSE_KEY,
    ...overrides,
  };
}

async function withServer(options, callback) {
  const app = createApp({
    environment: { TRUST_PROXY_HOPS: "0" },
    logger: { error() {}, warn() {} },
    rateLimitOptions: { enabled: false },
    updateMetadata: null,
    ...options,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await callback(baseUrl);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function postJson(baseUrl, route, body, headers = {}) {
  return fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("CORS preserva Electron e loopback mesmo com origens adicionais", async () => {
  const allowed = resolveAllowedOrigins({
    CORS_ALLOWED_ORIGINS: "https://painel.atelor.example",
  });
  assert.equal(allowed.has("null"), true);
  assert.equal(allowed.has("file://"), true);
  assert.equal(allowed.has("http://localhost:3000"), true);
  assert.equal(allowed.has("http://127.0.0.1:3000"), true);
  assert.equal(allowed.has("http://[::1]:3000"), true);
  assert.equal(allowed.has("https://painel.atelor.example"), true);
  assert.equal(allowed.has("http://localhost.evil.example:3000"), false);
  assert.equal(allowed.has("http://127.0.0.1.evil.example:3000"), false);

  await withServer(
    {
      LicenseModel: createFakeLicenseModel([]),
      environment: {
        TRUST_PROXY_HOPS: "0",
        CORS_ALLOWED_ORIGINS: "https://painel.atelor.example",
      },
    },
    async (baseUrl) => {
      for (const origin of [
        "null",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://[::1]:3000",
        "https://painel.atelor.example",
      ]) {
        const response = await fetch(`${baseUrl}/license/validate`, {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
          },
        });
        assert.equal(response.status, 204);
        assert.equal(response.headers.get("access-control-allow-origin"), origin);
      }

      for (const origin of [
        "https://evil.example",
        "http://localhost.evil.example:3000",
        "http://127.0.0.1.evil.example:3000",
        "http://[::1]:3001",
      ]) {
        const forbidden = await fetch(`${baseUrl}/license/validate`, {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": "POST",
          },
        });
        assert.equal(forbidden.status, 403);
        assert.equal(forbidden.headers.get("access-control-allow-origin"), null);
      }
    },
  );
});

test("machine ID legado aceita somente de 8 a 32 caracteres", () => {
  assert.equal(normalizeMachineId(`pc-${"a".repeat(8)}`), `pc-${"a".repeat(8)}`);
  assert.equal(
    normalizeMachineId(`pc-${"b".repeat(32)}`),
    `pc-${"b".repeat(32)}`,
  );
  assert.throws(() => normalizeMachineId(`pc-${"a".repeat(7)}`), /inválida/);
  assert.throws(() => normalizeMachineId(`pc-${"a".repeat(33)}`), /inválida/);
});

test("sanitizeFilter preserva os operadores confiáveis de expiração", () => {
  const now = new Date("2026-08-28T12:00:00.000Z");
  const filter = activeExpirationFilter(now);

  mongoose.sanitizeFilter(filter);

  const comparableBranches = filter.$or.map(({ expiracao }) => ({
    expiracao:
      expiracao && typeof expiracao === "object" && !(expiracao instanceof Date)
        ? Object.fromEntries(Object.entries(expiracao))
        : expiracao,
  }));
  assert.deepEqual(comparableBranches, [
    { expiracao: null },
    { expiracao: { $exists: false } },
    { expiracao: { $gt: now } },
  ]);
});

test("aceita formatos históricos de serial sem restringir pontuação ou Unicode", async () => {
  const historicalFormats = [
    "123456",
    "Senha@123!",
    "cliente.teste@example.com",
    "Plano VIP 2026",
    "ATELOR/PRO+CLIENTE=01",
    "Ação-Promoção#1",
  ];

  await withServer(
    { LicenseModel: createFakeLicenseModel([]) },
    async (baseUrl) => {
      for (const licenseKey of historicalFormats) {
        const response = await postJson(baseUrl, "/license/activate", {
          licenseKey,
          machineId: MACHINE_A,
        });
        assert.equal(
          response.status,
          404,
          `O formato histórico ${JSON.stringify(licenseKey)} deve chegar à busca`,
        );
        assert.equal((await response.json()).error, "Serial não encontrado.");
      }
    },
  );
});

test("rejeita serial vazio, controles, tamanho excessivo e tipos não escalares", async () => {
  const invalidLicenseKeys = [
    "",
    "   ",
    "ATELOR\nTESTE",
    "ATELOR\u0000TESTE",
    "ATELOR\u0085TESTE",
    "x".repeat(257),
    { $ne: null },
    ["ATELOR-TESTE"],
    null,
  ];

  await withServer(
    { LicenseModel: createFakeLicenseModel([]) },
    async (baseUrl) => {
      for (const licenseKey of invalidLicenseKeys) {
        const response = await postJson(baseUrl, "/license/activate", {
          licenseKey,
          machineId: MACHINE_A,
        });
        assert.equal(
          response.status,
          400,
          `O serial inválido ${JSON.stringify(licenseKey)} deve ser rejeitado`,
        );
      }
    },
  );
});

test("rejeita NoSQL injection, campos extras e machine ID inválido", async () => {
  const model = createFakeLicenseModel([baseLicense()]);
  await withServer({ LicenseModel: model }, async (baseUrl) => {
    const injection = await postJson(baseUrl, "/license/activate", {
      licenseKey: { $ne: null },
      machineId: MACHINE_A,
    });
    assert.equal(injection.status, 400);

    const extra = await postJson(baseUrl, "/license/activate", {
      licenseKey: LICENSE_KEY,
      machineId: MACHINE_A,
      admin: true,
    });
    assert.equal(extra.status, 400);

    const invalidMachine = await postJson(baseUrl, "/license/activate", {
      licenseKey: LICENSE_KEY,
      machineId: "pc-curto",
    });
    assert.equal(invalidMachine.status, 400);
    assert.equal(model.updateCount, 0);
  });
});

test("rejeita JSON malformado e corpo maior que 4 KiB", async () => {
  await withServer(
    { LicenseModel: createFakeLicenseModel([]) },
    async (baseUrl) => {
      const malformed = await fetch(`${baseUrl}/license/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      });
      assert.equal(malformed.status, 400);

      const oversized = await fetch(`${baseUrl}/license/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(5_000) }),
      });
      assert.equal(oversized.status, 413);
    },
  );
});

test("activate é atômico, idempotente e limita o histórico", async () => {
  const oldHistory = Array.from({ length: 205 }, (_, index) => ({
    id_maquina: LEGACY_MACHINE,
    acao: "DEACTIVATE",
    data: new Date(2020, 0, index + 1),
  }));
  const model = createFakeLicenseModel([
    baseLicense({ historico_ativacoes: oldHistory }),
  ]);

  await withServer(
    { LicenseModel: model, updateMetadata: UPDATE_METADATA },
    async (baseUrl) => {
      const first = await postJson(baseUrl, "/license/activate", {
        licenseKey: `  ${LICENSE_KEY}  `,
        machineId: MACHINE_A.toUpperCase(),
      });
      assert.equal(first.status, 200);
      const firstPayload = await first.json();
      assert.deepEqual(firstPayload.update, UPDATE_METADATA);

      const second = await postJson(baseUrl, "/license/activate", {
        licenseKey: LICENSE_KEY,
        machineId: MACHINE_A,
      });
      assert.equal(second.status, 200);
    },
  );

  const stored = model.get();
  assert.equal(stored.id_maquina, MACHINE_A);
  assert.equal(stored.historico_ativacoes.length, 200);
  assert.equal(stored.historico_ativacoes.at(-1).acao, "ACTIVATE");
  assert.equal(model.updateCount, 1);
});

test("duas máquinas concorrentes não conseguem ativar a mesma licença", async () => {
  const model = createFakeLicenseModel([baseLicense()]);
  await withServer({ LicenseModel: model }, async (baseUrl) => {
    const responses = await Promise.all([
      postJson(baseUrl, "/license/activate", {
        licenseKey: LICENSE_KEY,
        machineId: MACHINE_A,
      }),
      postJson(baseUrl, "/license/activate", {
        licenseKey: LICENSE_KEY,
        machineId: MACHINE_B,
      }),
    ]);
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 409],
    );
  });
  assert.equal(model.get().historico_ativacoes.length, 1);
});

test("validate não altera histórico quando a máquina já coincide", async () => {
  const model = createFakeLicenseModel([
    baseLicense({
      id_maquina: MACHINE_A,
      historico_ativacoes: [
        { id_maquina: MACHINE_A, acao: "ACTIVATE", data: new Date() },
      ],
    }),
  ]);

  await withServer(
    { LicenseModel: model, updateMetadata: UPDATE_METADATA },
    async (baseUrl) => {
      const response = await postJson(baseUrl, "/license/validate", {
        licenseKey: LICENSE_KEY,
        machineId: MACHINE_A,
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.valid, true);
      assert.equal(payload.migrated, false);
      assert.equal(payload.latestVersion, UPDATE_METADATA.version);
    },
  );
  assert.equal(model.updateCount, 0);
  assert.equal(model.get().historico_ativacoes.length, 1);
});

test("validate migra exatamente o ID legado uma única vez", async () => {
  const model = createFakeLicenseModel([
    baseLicense({ id_maquina: LEGACY_MACHINE }),
  ]);

  await withServer({ LicenseModel: model }, async (baseUrl) => {
    const migrated = await postJson(baseUrl, "/license/validate", {
      licenseKey: LICENSE_KEY,
      machineId: MACHINE_A,
      legacyMachineId: LEGACY_MACHINE,
    });
    assert.equal(migrated.status, 200);
    assert.equal((await migrated.json()).migrated, true);

    const replay = await postJson(baseUrl, "/license/validate", {
      licenseKey: LICENSE_KEY,
      machineId: MACHINE_A,
      legacyMachineId: LEGACY_MACHINE,
    });
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).migrated, false);
  });

  const stored = model.get();
  assert.equal(stored.id_maquina, MACHINE_A);
  assert.equal(stored.historico_ativacoes.length, 1);
  assert.equal(stored.historico_ativacoes[0].acao, "MIGRATE");
  assert.equal(
    stored.historico_ativacoes[0].id_maquina_anterior,
    LEGACY_MACHINE,
  );
});

test("validate recusa prova legada errada e licença expirada", async () => {
  const model = createFakeLicenseModel([
    baseLicense({ id_maquina: LEGACY_MACHINE }),
    baseLicense({
      _id: "expired",
      licenseKey: "ATELOR-TEST-EXPIRED",
      id_maquina: LEGACY_MACHINE,
      expiracao: new Date("2020-01-01T00:00:00.000Z"),
    }),
  ]);

  await withServer({ LicenseModel: model }, async (baseUrl) => {
    const wrongProof = await postJson(baseUrl, "/license/validate", {
      licenseKey: LICENSE_KEY,
      machineId: MACHINE_A,
      legacyMachineId: "pc-outroidvalido",
    });
    assert.equal(wrongProof.status, 403);
    assert.equal((await wrongProof.json()).reason, "machine_mismatch");

    const expired = await postJson(baseUrl, "/license/validate", {
      licenseKey: "ATELOR-TEST-EXPIRED",
      machineId: MACHINE_A,
      legacyMachineId: LEGACY_MACHINE,
    });
    assert.equal(expired.status, 403);
    assert.equal((await expired.json()).reason, "expired");
  });
  assert.equal(model.updateCount, 0);
});

test("deactivate altera somente a associação correspondente", async () => {
  const model = createFakeLicenseModel([
    baseLicense({ id_maquina: MACHINE_A }),
  ]);

  await withServer({ LicenseModel: model }, async (baseUrl) => {
    const wrongMachine = await postJson(baseUrl, "/license/deactivate", {
      licenseKey: LICENSE_KEY,
      machineId: MACHINE_B,
    });
    assert.equal(wrongMachine.status, 403);

    const success = await postJson(baseUrl, "/license/deactivate", {
      licenseKey: LICENSE_KEY,
      machineId: MACHINE_A,
    });
    assert.equal(success.status, 200);
  });
  assert.equal(model.get().id_maquina, null);
  assert.equal(model.get().historico_ativacoes.at(-1).acao, "DEACTIVATE");
});

test("rate limit conta falhas de ativação e retorna Retry-After", async () => {
  const model = createFakeLicenseModel([]);
  await withServer(
    {
      LicenseModel: model,
      rateLimitOptions: {
        generalLimit: 100,
        actionFailureLimit: 1,
        actionWindowMs: 60_000,
        validationFailureLimit: 100,
      },
    },
    async (baseUrl) => {
      const body = { licenseKey: LICENSE_KEY, machineId: MACHINE_A };
      const first = await postJson(baseUrl, "/license/activate", body);
      assert.equal(first.status, 404);
      const second = await postJson(baseUrl, "/license/activate", body);
      assert.equal(second.status, 429);
      assert.ok(Number(second.headers.get("retry-after")) >= 1);
    },
  );
});
