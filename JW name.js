const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const NAME_DB_PATH = path.join(__dirname, 'db', 'nameDB.xlsx');

function saveNewUser({ nickname, wallet }) {
  try {
    let wb, ws, data;

    if (fs.existsSync(NAME_DB_PATH)) {
      wb = XLSX.readFile(NAME_DB_PATH);
      ws = wb.Sheets[wb.SheetNames[0]];
      data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    } else {
      wb = XLSX.utils.book_new();
      data = [['Nickname', 'Wallet']];
      ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    }

    const existing = data.slice(1).some(row => row[1]?.toString().toLowerCase().trim() === wallet.toLowerCase().trim());
    if (existing) {
      console.log(`🔍 [name.js] 이미 등록된 지갑: ${wallet}`);
      return false;
    }

    data.push([nickname, wallet.toLowerCase()]);

    const newWs = XLSX.utils.aoa_to_sheet(data);
    wb.Sheets[wb.SheetNames[0]] = newWs;
    XLSX.writeFile(wb, NAME_DB_PATH);

    console.log(`✅ [name.js] 신규 사용자 저장: ${nickname} (${wallet})`);
    return true;
  } catch (err) {
    console.error('❌ [name.js] 신규 사용자 저장 오류:', err);
    return false;
  }
}

module.exports = { saveNewUser };
