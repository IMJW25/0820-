const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const path = require('path');
const xlsx = require('xlsx');

const { calcConfirmScores } = require('./ConfirmScore');
const { selectVerifiers } = require('./Confirm');
const { processClick, recordClick } = require('./Click');
const { calcPersonalRelScores } = require('./PRelScore');
const { saveNewUser } = require('./name');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

app.use(express.json());

// 신규 사용자 등록 API 예시 (기존)
// 필요한 경우 클라이언트에서 호출하여 파일에 저장함
app.post('/api/registerUser', (req, res) => {
  const { nickname, wallet } = req.body;

  if (!nickname || !wallet) {
    return res.status(400).json({ error: '닉네임과 지갑주소가 필요합니다.' });
  }

  const saved = saveNewUser({ nickname, wallet });
  if (saved) {
    nameDB.set(wallet.toLowerCase(), nickname);
    res.json({ status: 'success', message: '신규 사용자 저장 완료' });
  } else {
    res.status(500).json({ status: 'fail', message: '저장 실패 또는 이미 존재하는 사용자' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const userSockets = new Map();      // 지갑주소 → socket.id
const validatorSockets = new Map(); // 검증자 지갑주소 → socket.id

const NAME_DB_PATH = path.join(__dirname, 'db', 'nameDB.xlsx');
const CHAT_LOGS_PATH = path.join(__dirname, 'db', 'chatLogsDB.xlsx');

const nameDB = new Map();
const pendingVerifications = {};
let validators = [];

// nameDB 로드 함수 (서버 시작 시 호출)
function loadNameDB() {
  try {
    const wb = xlsx.readFile(NAME_DB_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(ws, { header: 1 }).slice(1);

    nameDB.clear();
    for (const row of data) {
      const nickname = row?.toString().trim();
      const wallet = row[1]?.toString().toLowerCase().trim();
      if (nickname && wallet) nameDB.set(wallet, nickname);
    }
    console.log('✅ nameDB 로드 완료:', nameDB.size);
  } catch (err) {
    console.error('❌ nameDB 로드 오류:', err);
  }
}
loadNameDB();

function loadChatLogs() {
  try {
    const wb = xlsx.readFile(CHAT_LOGS_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(ws, { header: 1 }).slice(1);
    return data.map(row => ({
      fromUser: row,
      message: row[1],
      timestamp: row,
    }));
  } catch (err) {
    console.error('❌ 채팅 로그 로드 오류:', err);
    return [];
  }
}

function saveChatLog({ fromUser, message }) {
  try {
    console.log('💾 chatLogs 저장 시작:', { fromUser, message });
    const wb = xlsx.readFile(CHAT_DB_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(ws, { header: 1 });

    // 새 행 추가
    const timestamp = new Date().toISOString();
    data.push([fromUser, message, timestamp]); // 반드시 [fromUser, message, timestamp] 형태

    // 시트 업데이트
    const newWs = xlsx.utils.aoa_to_sheet(data);
    wb.Sheets[wb.SheetNames] = newWs;
    xlsx.writeFile(wb, CHAT_DB_PATH);
    console.log('✅ chatLogs 저장 완료');
  } catch (err) {
    console.error('❌ chatLogs 저장 오류:', err);
  }
}


io.on('connection', (socket) => {
  console.log(`클라이언트 연결됨: ${socket.id}`);

  // registerUser: 클라이언트가 접속 시 호출
  socket.on('registerUser', async ({ walletAddr, nickname }) => {
    const normalizedWallet = walletAddr.toLowerCase();
   const isExistingUser = nameDB.has(normalizedWallet);

    userSockets.set(normalizedWallet, { socketId: socket.id, nickname });

   if (isExistingUser) {
      console.log(`기존 사용자 등록: ${walletAddr} (${nickname})`);
      // 기존 사용자는 검증자 승인 없이 즉시 입장 완료 이벤트를 보냄
      socket.emit('verificationCompleted', { approved: true });
   } else {
      // 신규 사용자는 검증자 승인 절차 시작 (requestEntry에서 처리)
      console.log(`신규 사용자 등록 시도: ${walletAddr} (${nickname})`);
      // 신규 사용자는 페이지 이동 없이 대기상태로 놓고, 이제 requestEntry에서 진행
    }
  });


  socket.on('registerValidator', ({ walletAddr, nickname }) => {
    const normalizedWallet = walletAddr.toLowerCase();
    validatorSockets.set(normalizedWallet, socket.id);
    console.log(`🔔 검증자 등록됨: ${walletAddr} (${nickname})`);
  });

  // 기존 채팅 로그 전송
  const logs = loadChatLogs();
  socket.emit('chatLogs', logs);

// sendMessage 이벤트 핸들러
socket.on('sendMessage', ({ fromUser, message }) => {
  saveChatLog({ fromUser, message });
  const toSocketInfo = userSockets.get(fromUser.toLowerCase());
  if (toSocketInfo) io.to(toSocketInfo.socketId).emit('receiveMessage', { fromUser, message });
  socket.emit('receiveMessage', { fromUser, message });
});
  // 신규 사용자 입장 요청 시 검증 절차 시작
  socket.on('requestEntry', async ({ wallet, nickname }) => {
    const candidate = wallet.toLowerCase();
    if (pendingVerifications[candidate]) return;

    const isExisting = nameDB.has(candidate);

    if (!isExisting) {
      await calcConfirmScores();
      validators = selectVerifiers();

      pendingVerifications[candidate] = {
        validators: validators.map(v => v.id),
        votes: {},
        nickname,
        link: ''
      };

      for (const vAddr of pendingVerifications[candidate].validators) {
        const vSocketId = validatorSockets.get(vAddr.toLowerCase());
        if (vSocketId) {
          io.to(vSocketId).emit('verificationRequested', {
            candidate,
            nickname,
            message: `${nickname}(${candidate}) 님이 입장 요청`,
            validators: pendingVerifications[candidate].validators
          });
        }
      }

      const socketInfo = userSockets.get(candidate);
      if (socketInfo) {
        io.to(socketInfo.socketId).emit('waitingForApproval');
      }
    } else {
      const socketInfo = userSockets.get(candidate);
      if (socketInfo) {
        io.to(socketInfo.socketId).emit('verificationCompleted', { candidate, approved: true });
      }
    }
  });

  socket.on('vote', ({ candidate, verifier, approve }) => {
    verifier = verifier.toLowerCase();
    const data = pendingVerifications[candidate];
    if (!data || data.votes[verifier] !== undefined) return;

    data.votes[verifier] = !!approve;
    if (Object.keys(data.votes).length === data.validators.length) {
      finalizeVerification(candidate);
    }
  });

  socket.on('linkClicked', async ({ fromUser, toUser, link }) => {
    // 기존 링크 클릭 처리 로직...
  });

  socket.on('disconnect', () => {
    for (const [wallet, info] of userSockets.entries()) {
      if (info.socketId === socket.id) userSockets.delete(wallet);
    }
    for (const [v, id] of validatorSockets.entries()) {
      if (id === socket.id) validatorSockets.delete(v);
    }
    console.log(`클라이언트 해제: ${socket.id}`);
  });
});

function finalizeVerification(candidate) {
  const data = pendingVerifications[candidate];
  if (!data) return;

  const approvals = Object.values(data.votes).filter(v => v).length;
  const total = data.validators.length;
  const approved = approvals * 3 >= total * 2; // 2/3 이상 찬성

  if (approved) console.log(`✅ ${candidate} 승인 (${approvals}/${total})`);
  else console.log(`❌ ${candidate} 거절 (${approvals}/${total})`);

  const socketInfo = userSockets.get(candidate);
  if (socketInfo) io.to(socketInfo.socketId).emit('verificationCompleted', { candidate, approved });

  data.validators.forEach(v => {
    const vId = validatorSockets.get(v.toLowerCase());
    if (vId) io.to(vId).emit('verificationResult', { candidate, approved });
  });

  delete pendingVerifications[candidate];
}

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
