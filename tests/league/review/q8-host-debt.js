// 기존 CLI 유지: node tests/league/review/q8-host-debt.js [씨앗,..] [달 수] [성향]
"use strict";
const hostDebt = require("./53-host-debt.js");
module.exports = hostDebt;
if (require.main === module) hostDebt.main(process.argv.slice(2), true);
