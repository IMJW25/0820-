// Confirm.js
const XLSX = require("xlsx");
const path = require("path");

// 파일 경로
const CONFIRM_SCORE_PATH = path.join(__dirname, 'db', "ConfirmScoreDB.xlsx");

function selectVerifiers() {
    console.log("🔍 [Confirm] selectVerifiers 호출 시작");

    // 1. 데이터 로드
    let wb;
    try {
        wb = XLSX.readFile(CONFIRM_SCORE_PATH);
        console.log("✅ [Confirm] ConfirmScoreDB.xlsx 로드 성공");
    } catch (err) {
        console.error("❌ [Confirm] 엑셀 파일 로드 오류:", err);
        return [];
    }

    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

    // 첫 행 ["ID", "ConfirmScore"] 제거
    const rows = data.slice(1);

    // 2. 멤버와 점수 불러오기
    const members = rows.map(row => ({
        id: row[0]?.toString().trim(),
        score: parseFloat(row)
    }));
    console.log(`📊 [Confirm] 멤버 로드 완료: ${members.length}명`);

    const n = members.length;

    // 3. 정렬 (점수 내림차순, 점수 같으면 알파벳 사전순 오름차순)
    members.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.id.localeCompare(b.id);
    });

    // 4. 검증자 수 결정 (기본 규칙)
    let verifierCount;
    if (n < 4) verifierCount = n;
    else if (n <= 10) verifierCount = 3;
    else if (n <= 99) verifierCount = 5;
    else verifierCount = 10;
    console.log(`🔢 [Confirm] 검증자 수 결정: ${verifierCount}`);

    // 5. 검증자 후보 선정 (score >= 0.5)
    const candidates = members.filter(m => m.score >= 0.5);
    console.log(`👥 [Confirm] 후보자 수 (score>=0.5): ${candidates.length}`);

    // 실제 검증자 = candidates 중 상위 verifierCount명
    const verifiers = candidates.slice(0, verifierCount);

    // 6. 결과 출력
    if (verifiers.length === 0) {
        console.warn("⚠️ [Confirm] 조건(0.5 이상)에 맞는 검증자가 없습니다.");
    } else {
        console.log("=== [Confirm] 검증자 선정 결과 ===");
        verifiers.forEach((v, idx) => {
            console.log(`  ${idx + 1}. ${v.id} (점수: ${v.score})`);
        });
    }

    console.log("✅ [Confirm] selectVerifiers 반환:", verifiers);
    return verifiers;
}

// 모듈 직접 실행 시에도 로그 확인
if (require.main === module) {
    console.log("🛠️ [Confirm] standalone 실행 모드");
    selectVerifiers();
}

module.exports = { selectVerifiers };
