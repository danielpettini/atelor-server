// License.js

const mongoose = require('mongoose');

// ********** SUBDOCUMENTO: HISTÓRICO DE ATIVAÇÕES **********

const activationLogSchema = new mongoose.Schema(
  {
    machineId: { type: String, required: true },
    action: { type: String, enum: ['ACTIVATE', 'DEACTIVATE'], required: true },
    date: { type: Date, default: Date.now },
  },
  { _id: false }
);

// ********** SCHEMA PRINCIPAL **********

const licenseSchema = new mongoose.Schema({
  licenseKey: { type: String, required: true, unique: true },

  plan: {
    type: String,
    enum: ['BASICO', 'INTERMEDIARIO', 'VIP'],
    default: 'BASICO',
  },

  clientName: { type: String, default: '' },
  clientEmail: { type: String, required: true },

  machineId: { type: String, default: null },

  isActive: { type: Boolean, default: true },
  revokedReason: { type: String, default: null },

  expiresAt: { type: Date, default: null },

  activatedAt: { type: Date, default: null },
  activationHistory: { type: [activationLogSchema], default: [] },

  createdAt: { type: Date, default: Date.now },
});

licenseSchema.index({ clientEmail: 1 });

module.exports = mongoose.model('License', licenseSchema, 'licenses');