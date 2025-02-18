var mongoose = require('mongoose');

var Schema = mongoose.Schema;

var transactions = new Schema({
    status: {
        type: String,
        index: true
    },
    error: String,
    Approval: Boolean,

    tran_id: {
        type: String,
        unique: true,
        index: true
    },
    sessionkey: {
        type: String,
        index: true
    },
    currency_amount: Number,
    store_amount: Number,

    Coupon: {
        type: String,
        index: true
    },
    discount_amount: String,
    discount_percentage: String,
    discount_remarks: String,


    ProductName: {
        type: String,
        index: true
    },
    // Product: Products,
    uid: {
        type: String,
        index: true
    },
    Name: {
        type: String,
        index: true
    },

    FbName: {
        type: String,
        index: true
    },
    FbLink: {
        type: String,
        index: true
    },

    Email: {
        type: String,
        index: true,
        validate: /^([a-zA-Z0-9_\-\.]+)@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.)|(([a-zA-Z0-9\-]+\.)+))([a-zA-Z]{1,5}|[0-9]{1,3})(\]?)$/
    },
    Phone: {
        type: String,
        index: true,
        validate: /^(?:\+88|88)?(01[3-9]\d{8})$/

    },
    Institution: {
        type: String,
        index: true
    },
    HSC: {
        type: String,
        index: true
    },

    affiliate: {
        type: String,
        index: true
    },
    utm_id: String,
    utm_source: String,
    utm_medium: String,
    utm_campaign: String,
    utm_term: String,
    utm_content: String,
    lead: String,
    Referrer: String,
    o2o: {
        type: Number,
        index: true
    },
    Ip: String,
    Platform: {
        type: String,
        index: true
    },
    gw: {
        type: String,
        index: true
    },
    value_a: {
        type: String,
        index: true
    },
    value_b: String,
    value_c: String,
    value_d: String,

    card_type: String,
    card_no: String,
    card_issuer: String,

    bank_tran_id: String,
    bank_val_id: String,
    val_id: {
        type: String,
        index: true
    },
    digital_key: {
        type: Object,
        index: true
    },
    assigned: {
        type: String,
        index: true
    },
    validated_on: String,
    tran_date: {
        type: String,
        index: true
    },
    Timestamp: String
});

const Transaction = mongoose.model('Transaction', transactions);
module.exports = Transaction;