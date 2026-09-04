// atelor-server/app.js

// ********** IMPORTAÇÕES **********

const cors = require("cors");
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const mongoose = require("mongoose");

const License = require("./License");
const { loadUpdateMetadata } = require("./updateMetadata");
// ********** MÓDULO PRINCIPAL **********

const {
  NATIVE_MACHINE_ID_PATTERN,
  RequestValidationError,
  parseLicenseCredentials,
} = require("./validation");

const HISTORY_LIMIT = 200;
const DEFAULT_LOCAL_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://[::1]:3000",
];

function parseTrustProxyHops(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (value === 0 || value === "0") return 0;
  if (value === 1 || value === "1") return 1;
  throw new Error("TRUST_PROXY_HOPS deve ser 0 ou 1.");
}

function normalizeConfiguredOrigin(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === "null" || trimmed === "file://") return trimmed;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Origem CORS inválida: ${trimmed}`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`Origem CORS inválida: ${trimmed}`);
  }
  return parsed.origin;
}

function resolveAllowedOrigins(environment = process.env) {
  const origins = new Set(["null", "file://"]);
  const configured = environment.CORS_ALLOWED_ORIGINS;
  const candidates = [
    ...DEFAULT_LOCAL_ORIGINS,
    ...(configured ? configured.split(",") : []),
  ];

  for (const candidate of candidates) {
    const normalized = normalizeConfiguredOrigin(candidate);
    if (normalized) origins.add(normalized);
  }
  return origins;
}

function createCorsOptions(allowedOrigins) {
  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      const error = new Error("Origem não autorizada.");
      error.status = 403;
      error.code = "CORS_NOT_ALLOWED";
      callback(error);
    },
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: false,
    maxAge: 600,
    optionsSuccessStatus: 204,
  };
}

function rateLimitResponse(request, response) {
  const payload = { error: "Muitas tentativas. Aguarde e tente novamente." };
  if (request.path.endsWith("/validate")) payload.valid = false;
  response.status(429).json(payload);
}

function createRateLimiters(options = {}) {
  if (options.enabled === false) {
    const passThrough = (_request, _response, next) => next();
    return {
      action: passThrough,
      general: passThrough,
      validation: passThrough,
    };
  }

  const common = {
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: rateLimitResponse,
    passOnStoreError: false,
  };

  return {
    general: rateLimit({
      ...common,
      windowMs: options.generalWindowMs ?? 60_000,
      limit: options.generalLimit ?? 120,
    }),
    action: rateLimit({
      ...common,
      windowMs: options.actionWindowMs ?? 15 * 60_000,
      limit: options.actionFailureLimit ?? 10,
      skipSuccessfulRequests: true,
    }),
    validation: rateLimit({
      ...common,
      windowMs: options.validationWindowMs ?? 15 * 60_000,
      limit: options.validationFailureLimit ?? 60,
      skipSuccessfulRequests: true,
    }),
  };
}

function isExpired(license, now) {
  const expiration = license?.expiracao;
  if (expiration === null || expiration === undefined || expiration === "") {
    return false;
  }

  const expirationTime = new Date(expiration).getTime();
  return (
    !Number.isFinite(expirationTime) || expirationTime <= now.getTime()
  );
}

const SNAPSHOT_LICENSE_FIELDS = new Set(["ativo", "expiracao"]);

function unchangedLicenseFieldFilter(field, value) {
  if (!SNAPSHOT_LICENSE_FIELDS.has(field)) {
    throw new TypeError("Campo de licença não permitido no snapshot atômico.");
  }

  if (value === undefined) {
    return { [field]: mongoose.trusted({ $exists: false }) };
  }

  if (value === null) {
    return {
      $or: [
        { [field]: null },
        { [field]: mongoose.trusted({ $exists: false }) },
      ],
    };
  }

  return {
    $expr: mongoose.trusted({
      $eq: [
        {
          $getField: {
            field: { $literal: field },
            input: "$$CURRENT",
          },
        },
        { $literal: value },
      ],
    }),
  };
}

function appendHistory(entry) {
  return {
    historico_ativacoes: {
      $each: [entry],
      $slice: -HISTORY_LIMIT,
    },
  };
}

async function executeQuery(query, { lean = true, select } = {}) {
  let current = query;
  if (select && typeof current?.select === "function") {
    current = current.select(select);
  }
  if (lean && typeof current?.lean === "function") {
    current = current.lean();
  }
  return await current;
}

function findLicense(LicenseModel, licenseKey) {
  return executeQuery(LicenseModel.findOne({ licenseKey }), {
    select: "ativo plano expiracao id_maquina",
  });
}

function findOneAndUpdate(LicenseModel, filter, update) {
  return executeQuery(
    LicenseModel.findOneAndUpdate(filter, update, {
      new: true,
      runValidators: true,
    }),
  );
}

function updateFields(updateMetadata) {
  return {
    latestVersion: updateMetadata?.version ?? null,
    update: updateMetadata ?? null,
  };
}

function validLicenseResponse(license, updateMetadata, migrated = false) {
  return {
    ok: true,
    valid: true,
    plan: license.plano,
    migrated,
    ...updateFields(updateMetadata),
  };
}

function createApp({
  LicenseModel = License,
  environment = process.env,
  logger = console,
  now = () => new Date(),
  rateLimitOptions,
  updateMetadata = loadUpdateMetadata({ logger }),
} = {}) {
  const app = express();
  const trustProxyHops = parseTrustProxyHops(environment.TRUST_PROXY_HOPS);
  const allowedOrigins = resolveAllowedOrigins(environment);
  const limiters = createRateLimiters(rateLimitOptions);

  app.disable("x-powered-by");
  app.set("query parser", false);
  if (trustProxyHops > 0) app.set("trust proxy", trustProxyHops);

  app.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.get("/", (_request, response) => {
    response.json({ status: "ATELOR License Server está no ar." });
  });

  app.use("/license", cors(createCorsOptions(allowedOrigins)));
  app.use("/license", limiters.general);
  app.use("/license", express.json({ limit: "4kb", strict: true }));

  app.post("/license/activate", limiters.action, async (request, response, next) => {
    try {
      const { licenseKey, machineId } = parseLicenseCredentials(request.body);
      const currentTime = now();
      const license = await findLicense(LicenseModel, licenseKey);

      if (!license) {
        return response.status(404).json({ error: "Serial não encontrado." });
      }
      if (!license.ativo) {
        return response.status(403).json({ error: "Esta licença foi desativada." });
      }
      if (isExpired(license, currentTime)) {
        return response.status(403).json({ error: "Licença expirada." });
      }
      if (license.id_maquina === machineId) {
        return response.json({
          ok: true,
          message: "Licença já estava ativa nesta máquina.",
          plan: license.plano,
          ...updateFields(updateMetadata),
        });
      }
      if (license.id_maquina) {
        return response.status(409).json({
          error:
            "Esta licença já está em uso em outra máquina. Desative-a lá antes de ativar aqui.",
        });
      }

      const activated = await findOneAndUpdate(
        LicenseModel,
        {
          _id: license._id,
          $and: [
            { $or: [{ id_maquina: null }, { id_maquina: "" }] },
            unchangedLicenseFieldFilter("ativo", license.ativo),
            unchangedLicenseFieldFilter("expiracao", license.expiracao),
          ],
        },
        {
          $set: {
            id_maquina: machineId,
            ultima_ativacao: currentTime,
          },
          $push: appendHistory({
            id_maquina: machineId,
            acao: "ACTIVATE",
            data: currentTime,
          }),
        },
      );

      if (!activated) {
        const winner = await findLicense(LicenseModel, licenseKey);
        if (winner?.id_maquina === machineId) {
          return response.json({
            ok: true,
            message: "Licença já estava ativa nesta máquina.",
            plan: winner.plano,
            ...updateFields(updateMetadata),
          });
        }
        return response.status(409).json({
          error: "A licença foi ativada em outra máquina simultaneamente.",
        });
      }

      return response.json({
        ok: true,
        message: "Licença ativada com sucesso.",
        plan: activated.plano,
        ...updateFields(updateMetadata),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/license/deactivate", limiters.action, async (request, response, next) => {
    try {
      const { licenseKey, machineId } = parseLicenseCredentials(request.body);
      const currentTime = now();
      const deactivated = await findOneAndUpdate(
        LicenseModel,
        { licenseKey, id_maquina: machineId },
        {
          $set: { id_maquina: null },
          $push: appendHistory({
            id_maquina: machineId,
            acao: "DEACTIVATE",
            data: currentTime,
          }),
        },
      );

      if (!deactivated) {
        const license = await findLicense(LicenseModel, licenseKey);
        if (!license) {
          return response.status(404).json({ error: "Serial não encontrado." });
        }
        return response.status(403).json({
          error: "Esta máquina não é a ativa para este serial.",
        });
      }

      return response.json({ ok: true, message: "Licença desativada." });
    } catch (error) {
      next(error);
    }
  });

  app.post("/license/validate", limiters.validation, async (request, response, next) => {
    try {
      const { licenseKey, machineId, legacyMachineId } =
        parseLicenseCredentials(request.body, { allowLegacyProof: true });
      const currentTime = now();
      const license = await findLicense(LicenseModel, licenseKey);

      if (!license || !license.ativo) {
        return response.status(403).json({ valid: false, reason: "invalid" });
      }
      if (isExpired(license, currentTime)) {
        return response.status(403).json({ valid: false, reason: "expired" });
      }
      if (license.id_maquina === machineId) {
        return response.json(validLicenseResponse(license, updateMetadata));
      }

      const canMigrate =
        legacyMachineId &&
        NATIVE_MACHINE_ID_PATTERN.test(machineId) &&
        license.id_maquina === legacyMachineId;
      if (!canMigrate) {
        return response
          .status(403)
          .json({ valid: false, reason: "machine_mismatch" });
      }

      const migrated = await findOneAndUpdate(
        LicenseModel,
        {
          _id: license._id,
          id_maquina: legacyMachineId,
          $and: [
            unchangedLicenseFieldFilter("ativo", license.ativo),
            unchangedLicenseFieldFilter("expiracao", license.expiracao),
          ],
        },
        {
          $set: { id_maquina: machineId },
          $push: appendHistory({
            id_maquina: machineId,
            id_maquina_anterior: legacyMachineId,
            acao: "MIGRATE",
            data: currentTime,
          }),
        },
      );

      if (migrated) {
        return response.json(
          validLicenseResponse(migrated, updateMetadata, true),
        );
      }

      const concurrentResult = await findLicense(LicenseModel, licenseKey);
      if (
        concurrentResult?.ativo &&
        concurrentResult.id_maquina === machineId &&
        !isExpired(concurrentResult, currentTime)
      ) {
        return response.json(
          validLicenseResponse(concurrentResult, updateMetadata),
        );
      }
      return response
        .status(403)
        .json({ valid: false, reason: "machine_mismatch" });
    } catch (error) {
      next(error);
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: "Rota não encontrada." });
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof RequestValidationError) {
      return response.status(400).json({ error: error.message });
    }
    if (error.code === "CORS_NOT_ALLOWED") {
      return response.status(403).json({ error: "Origem não autorizada." });
    }
    if (error.type === "entity.too.large") {
      return response.status(413).json({ error: "Requisição muito grande." });
    }
    if (error instanceof SyntaxError && error.type === "entity.parse.failed") {
      return response.status(400).json({ error: "JSON inválido." });
    }

    logger.error?.("Erro interno no servidor:", error);
    return response.status(500).json({
      error: "Erro interno no servidor. Tente novamente mais tarde.",
    });
  });

  return app;
}

module.exports = {
  HISTORY_LIMIT,
  createApp,
  createCorsOptions,
  createRateLimiters,
  parseTrustProxyHops,
  resolveAllowedOrigins,
  unchangedLicenseFieldFilter,
};
