// License.js

const mongoose = require('mongoose');

// ********** SUBDOCUMENTO: HISTÓRICO DE ATIVAÇÕES **********

const registroAtivacaoSchema = new mongoose.Schema(
  {
    id_maquina: { type: String, required: true },
    acao: { type: String, enum: ['ACTIVATE', 'DEACTIVATE'], required: true },
    data: { type: Date, default: Date.now },
  },
  { _id: false }
);

// ********** SCHEMA PRINCIPAL **********

const licenseSchema = new mongoose.Schema({
  ativo: { type: Boolean, default: true },  
  licenseKey: { type: String, required: true, unique: true },
  plano: {
    type: String,
    enum: ['BASICO', 'PRO', 'VIP'],
    required: true,
  },
  nome_cliente: { type: String, default: '' },
  email_cliente: { type: String, required: true },
  whatsapp: { type: String, default: '' },
  endereco: { type: String, default: '' },
  criado_em: { type: Date, default: Date.now },
  ultima_ativacao: { type: Date, default: null },  
  historico_ativacoes: { type: [registroAtivacaoSchema], default: [] },
  expiracao: { type: Date, default: null }, 
  id_maquina: { type: String, default: null },
});

licenseSchema.index({ email_cliente: 1 });

module.exports = mongoose.model('License', licenseSchema, 'licenses');