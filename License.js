// License.js

const mongoose = require("mongoose");

// ********** SUBDOCUMENTO: HISTÓRICO DE ATIVAÇÕES **********

const registroAtivacaoSchema = new mongoose.Schema(
  {
    id_maquina: { type: String, required: true, maxlength: 128 },
    id_maquina_anterior: { type: String, default: null, maxlength: 128 },
    acao: {
      type: String,
      enum: ["ACTIVATE", "DEACTIVATE", "MIGRATE"],
      required: true,
    },
    data: { type: Date, default: Date.now },
  },
  { _id: false },
);

// ********** SCHEMA PRINCIPAL **********

const licenseSchema = new mongoose.Schema(
  {
    ativo: { type: Boolean, default: true, index: true },
    licenseKey: { type: String, required: true, unique: true, index: true },
    plano: {
      type: String,
      enum: ["BASICO", "PRO", "VIP"],
      required: true,
    },
    nome_cliente: { type: String, default: "" },
    apelido: { type: String, default: "" },
    email_cliente: { type: String, required: true, index: true },
    whatsapp: { type: String, default: "" },
    endereco: { type: String, default: "" },
    ultima_ativacao: { type: Date, default: null },
    historico_ativacoes: { type: [registroAtivacaoSchema], default: [] },
    expiracao: { type: Date, default: null, index: true },
    id_maquina: { type: String, default: null, maxlength: 128, index: true },
  },
  {
    timestamps: { createdAt: "criado_em", updatedAt: "atualizado_em" },
  },
);

module.exports = mongoose.model("License", licenseSchema, "licenses");
