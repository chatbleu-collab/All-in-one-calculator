/* ============================================================
   올인원 계산기 - 메인 스크립트
   ------------------------------------------------------------
   구성:
   1) 유틸 (숫자 포맷, 파싱)
   2) 탭 전환
   3) 일반 계산기
   4) 퍼센트 계산기
   5) 나이 계산기 (띠 포함)
   6) 환율 계산기 (open.er-api.com)
   7) 서비스워커 등록
============================================================ */

"use strict";

// ============================================================
// 1) 유틸
// ============================================================

/** 숫자 문자열에 천단위 콤마 추가 (음수/소수 지원) */
function withCommas(str) {
  if (str === "" || str === "-" || str === "." || str === "-.") return str;
  const negative = str.startsWith("-");
  const body = negative ? str.slice(1) : str;
  const [intPart, decPart] = body.split(".");
  const intFmt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const out = decPart !== undefined ? intFmt + "." + decPart : intFmt;
  return negative ? "-" + out : out;
}

/** 결과 숫자를 표시용 문자열로 변환 (부동소수점 오차 정리, 소수 최대한 보존) */
function formatNumber(n) {
  if (!isFinite(n)) return "오류";
  if (Number.isNaN(n)) return "오류";
  if (Math.abs(n) >= 1e21) return n.toExponential(6);
  // JS Number 정밀 한계(~15자리)까지 유지하되, 부동소수점 오차는 제거.
  // parseFloat 이 후행 0을 자동으로 잘라내므로 정수는 정수 그대로 표시된다.
  return parseFloat(n.toPrecision(15)).toString();
}

/** 입력 문자열에서 콤마 제거 후 숫자 반환 */
function toNumber(str) {
  if (typeof str !== "string") return NaN;
  const clean = str.replace(/,/g, "").trim();
  if (clean === "" || clean === "-") return NaN;
  return parseFloat(clean);
}

// ============================================================
// 2) 탭 전환
// ============================================================
(function setupTabs() {
  const tabs = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".panel");
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      tabs.forEach((b) => b.classList.toggle("active", b === btn));
      panels.forEach((p) => p.classList.toggle("active", p.id === "tab-" + target));

      // 환율 탭을 처음 열 때 API 호출
      if (target === "currency" && !window.__currencyInited) {
        window.__currencyInited = true;
        CurrencyCalc.fetchRates();
      }
    });
  });
})();

// ============================================================
// 3) 일반 계산기
// ============================================================
const GeneralCalc = (function () {
  const subEl = document.getElementById("gen-sub");
  const mainEl = document.getElementById("gen-main");

  const state = {
    current: "0",          // 현재 입력 (문자열)
    previous: null,        // 이전 값
    operator: null,        // 현재 연산자
    waitingForNew: false,  // 연산자 직후 새 입력 대기
    lastOp: null,          // 마지막 연산자 (= 반복용)
    lastOperand: null,     // 마지막 피연산자
    hasError: false
  };

  function render() {
    mainEl.textContent = state.hasError ? "오류" : withCommas(state.current);
    // 서브 표시: previous operator (준비 중일 때)
    if (state.operator && state.previous !== null) {
      const opSym = { "+": "+", "-": "−", "*": "×", "/": "÷" }[state.operator] || state.operator;
      subEl.textContent = withCommas(state.previous) + " " + opSym;
    } else {
      subEl.textContent = "";
    }
  }

  function reset() {
    state.current = "0";
    state.previous = null;
    state.operator = null;
    state.waitingForNew = false;
    state.lastOp = null;
    state.lastOperand = null;
    state.hasError = false;
  }

  function inputDigit(d) {
    if (state.hasError) reset();
    if (state.waitingForNew) {
      state.current = d;
      state.waitingForNew = false;
    } else {
      if (state.current === "0") state.current = d;
      else if (state.current === "-0") state.current = "-" + d;
      else if (state.current.replace(/^-/, "").replace(".", "").length < 12) {
        state.current += d;
      }
    }
  }

  function inputDot() {
    if (state.hasError) reset();
    if (state.waitingForNew) {
      state.current = "0.";
      state.waitingForNew = false;
      return;
    }
    if (!state.current.includes(".")) state.current += ".";
  }

  function toggleSign() {
    if (state.hasError) return;
    if (state.current === "0") return;
    if (state.current.startsWith("-")) state.current = state.current.slice(1);
    else state.current = "-" + state.current;
  }

  function percent() {
    if (state.hasError) return;
    const n = parseFloat(state.current);
    if (isNaN(n)) return;
    state.current = formatNumber(n / 100);
  }

  function compute(a, b, op) {
    switch (op) {
      case "+": return a + b;
      case "-": return a - b;
      case "*": return a * b;
      case "/":
        if (b === 0) return NaN;
        return a / b;
    }
    return b;
  }

  function setOperator(op) {
    if (state.hasError) return;

    if (state.operator !== null && !state.waitingForNew) {
      // 연산 체이닝
      const a = parseFloat(state.previous);
      const b = parseFloat(state.current);
      const r = compute(a, b, state.operator);
      if (isNaN(r) || !isFinite(r)) { state.hasError = true; render(); return; }
      state.current = formatNumber(r);
      state.previous = state.current;
    } else {
      state.previous = state.current;
    }
    state.operator = op;
    state.waitingForNew = true;
    state.lastOp = null;
    state.lastOperand = null;
  }

  function equals() {
    if (state.hasError) return;

    let a, b, op;
    if (state.operator !== null && state.previous !== null) {
      a = parseFloat(state.previous);
      b = parseFloat(state.current);
      op = state.operator;
      state.lastOp = op;
      state.lastOperand = state.current;
    } else if (state.lastOp !== null && state.lastOperand !== null) {
      // = 반복: 마지막 연산 반복
      a = parseFloat(state.current);
      b = parseFloat(state.lastOperand);
      op = state.lastOp;
    } else {
      return;
    }

    const r = compute(a, b, op);
    if (isNaN(r) || !isFinite(r)) { state.hasError = true; render(); return; }
    state.current = formatNumber(r);
    state.previous = null;
    state.operator = null;
    state.waitingForNew = true;
  }

  // 키 바인딩
  document.getElementById("tab-general").addEventListener("click", (e) => {
    const btn = e.target.closest(".gen-key");
    if (!btn) return;
    const key = btn.dataset.key;
    if (/^[0-9]$/.test(key)) inputDigit(key);
    else if (key === ".") inputDot();
    else if (key === "C") reset();
    else if (key === "±") toggleSign();
    else if (key === "%") percent();
    else if (["+", "-", "*", "/"].includes(key)) setOperator(key);
    else if (key === "=") equals();
    render();
  });

  render();
  return { reset };
})();

// ============================================================
// 4) 퍼센트 계산기
// ============================================================
const PercentCalc = (function () {
  const baseInput = document.getElementById("pct-base");
  const rateInput = document.getElementById("pct-rate");
  const resVal = document.getElementById("pct-res-value");
  const resSub = document.getElementById("pct-res-sub");
  const addVal = document.getElementById("pct-add-value");
  const subVal = document.getElementById("pct-sub-value");

  let active = "base"; // "base" | "rate"

  function setActive(name) {
    active = name;
    baseInput.classList.toggle("active", name === "base");
    rateInput.classList.toggle("active", name === "rate");
    (name === "base" ? baseInput : rateInput).focus({ preventScroll: true });
  }

  function formatOnBlur(input) {
    // 콤마 재적용
    const raw = input.value.replace(/,/g, "");
    if (raw === "" || raw === "-" || raw === ".") { compute(); return; }
    const n = parseFloat(raw);
    if (isNaN(n)) return;
    // 정수부에만 콤마
    input.value = withCommas(raw);
  }

  function stripCommas(str) { return (str || "").replace(/,/g, ""); }

  function compute() {
    const base = parseFloat(stripCommas(baseInput.value));
    const rate = parseFloat(stripCommas(rateInput.value));

    if (isNaN(base) || isNaN(rate)) {
      resVal.textContent = "-";
      resSub.textContent = "? × ?%";
      addVal.textContent = "-";
      subVal.textContent = "-";
      return;
    }
    const result = base * rate / 100;
    resVal.textContent = withCommas(formatNumber(result));
    resSub.textContent = withCommas(formatNumber(base)) + " × " + withCommas(formatNumber(rate)) + "%";
    addVal.textContent = withCommas(formatNumber(base + result));
    subVal.textContent = withCommas(formatNumber(base - result));
  }

  // 입력창 클릭 시 활성 전환
  baseInput.addEventListener("focus", () => setActive("base"));
  rateInput.addEventListener("focus", () => setActive("rate"));
  baseInput.addEventListener("input", () => { compute(); });
  rateInput.addEventListener("input", () => { compute(); });
  baseInput.addEventListener("blur", () => { formatOnBlur(baseInput); compute(); });
  rateInput.addEventListener("blur", () => { formatOnBlur(rateInput); compute(); });

  // 키패드
  function targetInput() { return active === "base" ? baseInput : rateInput; }

  function insertText(t) {
    const inp = targetInput();
    const raw = stripCommas(inp.value);
    // 소수점 중복 방지
    if (t === "." && raw.includes(".")) return;
    // 최대 15자리 (정수부 기준) 제한
    if (t !== "." && raw.replace(".", "").length >= 15) return;
    inp.value = withCommas(raw + t);
    compute();
  }

  function backspace() {
    const inp = targetInput();
    let raw = stripCommas(inp.value);
    if (raw.length <= 0) return;
    raw = raw.slice(0, -1);
    inp.value = raw === "" ? "" : withCommas(raw);
    compute();
  }

  function clearAll() {
    baseInput.value = "";
    rateInput.value = "";
    compute();
    setActive("base");
  }

  function swap() {
    const b = baseInput.value;
    baseInput.value = rateInput.value;
    rateInput.value = b;
    compute();
  }

  document.querySelector(".pct-keys").addEventListener("click", (e) => {
    const btn = e.target.closest(".pct-key");
    if (!btn) return;
    const key = btn.dataset.key;
    if (key === "C") clearAll();
    else if (key === "BS") backspace();
    else if (key === "SW") swap();
    else insertText(key);
  });

  setActive("base");
  compute();
  return { compute };
})();

// ============================================================
// 5) 나이 계산기
// ============================================================
const AgeCalc = (function () {
  // 12간지 (기준: 서기 4년 = 자년/쥐)
  const ZODIAC = ["쥐", "소", "호랑이", "토끼", "용", "뱀", "말", "양", "원숭이", "닭", "개", "돼지"];
  const ZODIAC_EMOJI = ["🐭", "🐮", "🐯", "🐰", "🐲", "🐍", "🐴", "🐑", "🐵", "🐔", "🐶", "🐷"];

  /** 천문학적 연도 (BC n년 → -(n-1)) */
  function astroYear(year, isBC) {
    return isBC ? -(year - 1) : year;
  }

  /** 12간지 인덱스 계산 */
  function getZodiacIndex(y) {
    return ((y - 4) % 12 + 12) % 12;
  }

  /** 특정 (연,월,일)이 실제 존재하는 유효한 날짜인지 검사 */
  function isValidDate(y, m, d) {
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
    if (m < 1 || m > 12) return false;
    if (d < 1 || d > 31) return false;
    // 월별 일 수 (윤년 처리는 AD 기준)
    const daysInMonth = new Date(y > 0 ? y : 2020, m, 0).getDate();
    return d <= daysInMonth;
  }

  // ---------- 요소 ----------
  const eraBtns = document.querySelectorAll(".era-btn");
  const bYear = document.getElementById("birth-year");
  const bMonth = document.getElementById("birth-month");
  const bDay = document.getElementById("birth-day");
  const bSummary = document.getElementById("birth-summary");

  const aYear = document.getElementById("apply-year");
  const aMonth = document.getElementById("apply-month");
  const aDay = document.getElementById("apply-day");
  const aSummary = document.getElementById("apply-summary");

  const resYearly = document.getElementById("res-yearly");
  const resReal = document.getElementById("res-real");
  const resZodiacEmoji = document.getElementById("res-zodiac-emoji");
  const resZodiacName = document.getElementById("res-zodiac-name");
  const resZodiacSub = document.getElementById("res-zodiac-sub");

  // 역산
  const ageTypeBtns = document.querySelectorAll(".age-type-btn");
  const revAgeInput = document.getElementById("rev-age");
  const revBirthYear = document.getElementById("rev-birth-year");
  const revBirthLabel = document.getElementById("rev-birth-label");
  const revZodiac = document.getElementById("rev-zodiac");

  let birthIsBC = false;
  let revAgeType = "yearly"; // "yearly" | "real"

  // 오늘 날짜로 적용날짜 초기화
  const today = new Date();
  aYear.value = today.getFullYear();
  aMonth.value = today.getMonth() + 1;
  aDay.value = today.getDate();

  // 초기 생년월일 (스크린샷 기본값)
  bYear.value = 1995;
  bMonth.value = 1;
  bDay.value = 1;

  // 초기 역산 값
  revAgeInput.value = 30;

  function computeAge() {
    const by = parseInt(bYear.value, 10);
    const bm = parseInt(bMonth.value, 10);
    const bd = parseInt(bDay.value, 10);
    const ay = parseInt(aYear.value, 10);
    const am = parseInt(aMonth.value, 10);
    const ad = parseInt(aDay.value, 10);

    // 요약 텍스트
    if (Number.isInteger(by) && Number.isInteger(bm) && Number.isInteger(bd)) {
      const era = birthIsBC ? "기원전 " : "";
      bSummary.textContent = era + by + "년 " + bm + "월 " + bd + "일";
    } else {
      bSummary.textContent = "";
    }
    if (Number.isInteger(ay) && Number.isInteger(am) && Number.isInteger(ad)) {
      aSummary.textContent = ay + "년 " + am + "월 " + ad + "일";
    } else {
      aSummary.textContent = "";
    }

    // 유효성 검사
    if (!isValidDate(by, bm, bd) || !isValidDate(ay, am, ad)) {
      resYearly.textContent = "-";
      resReal.textContent = "-";
      resZodiacEmoji.textContent = "❓";
      resZodiacName.textContent = "-";
      resZodiacSub.textContent = "-";
      return;
    }

    // 천문학적 생년
    const astroBY = astroYear(by, birthIsBC);

    // 연 나이 = 적용연도 - 생년(신호 처리된)
    const yearly = ay - astroBY;

    // 만 나이 = 연 나이 - (생일이 아직 안 지났으면 1)
    let real = yearly;
    if (am < bm || (am === bm && ad < bd)) real -= 1;

    // 띠 계산
    const zi = getZodiacIndex(astroBY);

    resYearly.textContent = yearly + "세";
    resReal.textContent = real + "세";
    resZodiacEmoji.textContent = ZODIAC_EMOJI[zi];
    resZodiacName.textContent = ZODIAC[zi] + "띠";
    resZodiacSub.textContent = (birthIsBC ? "기원전 " : "") + by + "년생";
  }

  function computeReverse() {
    const age = parseInt(revAgeInput.value, 10);
    if (!Number.isInteger(age) || age < 0) {
      revBirthYear.textContent = "-";
      revZodiac.textContent = "-";
      revBirthLabel.textContent = "출생년도";
      return;
    }
    const curYear = today.getFullYear();
    const curMonth = today.getMonth() + 1;
    const curDay = today.getDate();

    let birthYear;
    if (revAgeType === "yearly") {
      birthYear = curYear - age;
    } else {
      // 만 나이 기준: 올해 생일 지났으면 currentYear - age, 아니면 -age-1의 극단이 있는데
      // "가장 흔한 케이스" = 올해 생일 아직 안 지난 사람 기준으로 currentYear - age - 1
      // 하지만 대표값 하나만 보여주므로: 올해 이미 생일 지난 것으로 가정 → currentYear - age
      birthYear = curYear - age;
    }

    revBirthYear.textContent = birthYear + "년";
    revBirthLabel.textContent = "출생년도 (" + (revAgeType === "yearly" ? "연 나이" : "만 나이") + " " + age + "세)";

    const zi = getZodiacIndex(birthYear);
    revZodiac.textContent = ZODIAC_EMOJI[zi] + " " + ZODIAC[zi] + "띠";
  }

  // BC/AD 토글
  eraBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      eraBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      birthIsBC = btn.dataset.era === "bc";
      computeAge();
    });
  });

  // 연 나이 / 만 나이 토글
  ageTypeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      ageTypeBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      revAgeType = btn.dataset.type;
      computeReverse();
    });
  });

  // 입력 변경 시 자동 재계산
  [bYear, bMonth, bDay, aYear, aMonth, aDay].forEach((inp) => {
    inp.addEventListener("input", computeAge);
  });
  revAgeInput.addEventListener("input", computeReverse);

  computeAge();
  computeReverse();
  return { computeAge, computeReverse };
})();

// ============================================================
// 6) 환율 계산기
// ============================================================
const CurrencyCalc = (function () {
  // 지원 통화 (open.er-api.com 이 반환하는 161개 통화)
  const CURRENCY_INFO = {
    AED: { flag: "🇦🇪", name: "아랍에미리트 디르함" },
    AFN: { flag: "🇦🇫", name: "아프가니스탄 아프가니" },
    ALL: { flag: "🇦🇱", name: "알바니아 레크" },
    AMD: { flag: "🇦🇲", name: "아르메니아 드람" },
    ANG: { flag: "🇨🇼", name: "네덜란드령 안틸레스 길더" },
    AOA: { flag: "🇦🇴", name: "앙골라 콴자" },
    ARS: { flag: "🇦🇷", name: "아르헨티나 페소" },
    AUD: { flag: "🇦🇺", name: "호주 달러" },
    AWG: { flag: "🇦🇼", name: "아루바 플로린" },
    AZN: { flag: "🇦🇿", name: "아제르바이잔 마나트" },
    BAM: { flag: "🇧🇦", name: "보스니아 헤르체고비나 마르카" },
    BBD: { flag: "🇧🇧", name: "바베이도스 달러" },
    BDT: { flag: "🇧🇩", name: "방글라데시 타카" },
    BGN: { flag: "🇧🇬", name: "불가리아 레프" },
    BHD: { flag: "🇧🇭", name: "바레인 디나르" },
    BIF: { flag: "🇧🇮", name: "부룬디 프랑" },
    BMD: { flag: "🇧🇲", name: "버뮤다 달러" },
    BND: { flag: "🇧🇳", name: "브루나이 달러" },
    BOB: { flag: "🇧🇴", name: "볼리비아 볼리비아노" },
    BRL: { flag: "🇧🇷", name: "브라질 헤알" },
    BSD: { flag: "🇧🇸", name: "바하마 달러" },
    BTN: { flag: "🇧🇹", name: "부탄 눌트룸" },
    BWP: { flag: "🇧🇼", name: "보츠와나 풀라" },
    BYN: { flag: "🇧🇾", name: "벨라루스 루블" },
    BZD: { flag: "🇧🇿", name: "벨리즈 달러" },
    CAD: { flag: "🇨🇦", name: "캐나다 달러" },
    CDF: { flag: "🇨🇩", name: "콩고민주공화국 프랑" },
    CHF: { flag: "🇨🇭", name: "스위스 프랑" },
    CLP: { flag: "🇨🇱", name: "칠레 페소" },
    CNY: { flag: "🇨🇳", name: "중국 위안" },
    COP: { flag: "🇨🇴", name: "콜롬비아 페소" },
    CRC: { flag: "🇨🇷", name: "코스타리카 콜론" },
    CUP: { flag: "🇨🇺", name: "쿠바 페소" },
    CVE: { flag: "🇨🇻", name: "카보베르데 에스쿠도" },
    CZK: { flag: "🇨🇿", name: "체코 코루나" },
    DJF: { flag: "🇩🇯", name: "지부티 프랑" },
    DKK: { flag: "🇩🇰", name: "덴마크 크로네" },
    DOP: { flag: "🇩🇴", name: "도미니카 페소" },
    DZD: { flag: "🇩🇿", name: "알제리 디나르" },
    EGP: { flag: "🇪🇬", name: "이집트 파운드" },
    ERN: { flag: "🇪🇷", name: "에리트레아 나크파" },
    ETB: { flag: "🇪🇹", name: "에티오피아 비르" },
    EUR: { flag: "🇪🇺", name: "유로" },
    FJD: { flag: "🇫🇯", name: "피지 달러" },
    FKP: { flag: "🇫🇰", name: "포클랜드 제도 파운드" },
    FOK: { flag: "🇫🇴", name: "페로 제도 크로나" },
    GBP: { flag: "🇬🇧", name: "영국 파운드" },
    GEL: { flag: "🇬🇪", name: "조지아 라리" },
    GGP: { flag: "🇬🇬", name: "건지 파운드" },
    GHS: { flag: "🇬🇭", name: "가나 세디" },
    GIP: { flag: "🇬🇮", name: "지브롤터 파운드" },
    GMD: { flag: "🇬🇲", name: "감비아 달라시" },
    GNF: { flag: "🇬🇳", name: "기니 프랑" },
    GTQ: { flag: "🇬🇹", name: "과테말라 케찰" },
    GYD: { flag: "🇬🇾", name: "가이아나 달러" },
    HKD: { flag: "🇭🇰", name: "홍콩 달러" },
    HNL: { flag: "🇭🇳", name: "온두라스 렘피라" },
    HRK: { flag: "🇭🇷", name: "크로아티아 쿠나" },
    HTG: { flag: "🇭🇹", name: "아이티 구르드" },
    HUF: { flag: "🇭🇺", name: "헝가리 포린트" },
    IDR: { flag: "🇮🇩", name: "인도네시아 루피아" },
    ILS: { flag: "🇮🇱", name: "이스라엘 셰켈" },
    IMP: { flag: "🇮🇲", name: "맨섬 파운드" },
    INR: { flag: "🇮🇳", name: "인도 루피" },
    IQD: { flag: "🇮🇶", name: "이라크 디나르" },
    IRR: { flag: "🇮🇷", name: "이란 리알" },
    ISK: { flag: "🇮🇸", name: "아이슬란드 크로나" },
    JEP: { flag: "🇯🇪", name: "저지 파운드" },
    JMD: { flag: "🇯🇲", name: "자메이카 달러" },
    JOD: { flag: "🇯🇴", name: "요르단 디나르" },
    JPY: { flag: "🇯🇵", name: "일본 엔" },
    KES: { flag: "🇰🇪", name: "케냐 실링" },
    KGS: { flag: "🇰🇬", name: "키르기스스탄 솜" },
    KHR: { flag: "🇰🇭", name: "캄보디아 리엘" },
    KID: { flag: "🇰🇮", name: "키리바시 달러" },
    KMF: { flag: "🇰🇲", name: "코모로 프랑" },
    KRW: { flag: "🇰🇷", name: "대한민국 원" },
    KWD: { flag: "🇰🇼", name: "쿠웨이트 디나르" },
    KYD: { flag: "🇰🇾", name: "케이맨 제도 달러" },
    KZT: { flag: "🇰🇿", name: "카자흐스탄 텡게" },
    LAK: { flag: "🇱🇦", name: "라오스 킵" },
    LBP: { flag: "🇱🇧", name: "레바논 파운드" },
    LKR: { flag: "🇱🇰", name: "스리랑카 루피" },
    LRD: { flag: "🇱🇷", name: "라이베리아 달러" },
    LSL: { flag: "🇱🇸", name: "레소토 로티" },
    LYD: { flag: "🇱🇾", name: "리비아 디나르" },
    MAD: { flag: "🇲🇦", name: "모로코 디르함" },
    MDL: { flag: "🇲🇩", name: "몰도바 레우" },
    MGA: { flag: "🇲🇬", name: "마다가스카르 아리아리" },
    MKD: { flag: "🇲🇰", name: "북마케도니아 데나르" },
    MMK: { flag: "🇲🇲", name: "미얀마 짯" },
    MNT: { flag: "🇲🇳", name: "몽골 투그릭" },
    MOP: { flag: "🇲🇴", name: "마카오 파타카" },
    MRU: { flag: "🇲🇷", name: "모리타니 우기야" },
    MUR: { flag: "🇲🇺", name: "모리셔스 루피" },
    MVR: { flag: "🇲🇻", name: "몰디브 루피야" },
    MWK: { flag: "🇲🇼", name: "말라위 콰차" },
    MXN: { flag: "🇲🇽", name: "멕시코 페소" },
    MYR: { flag: "🇲🇾", name: "말레이시아 링깃" },
    MZN: { flag: "🇲🇿", name: "모잠비크 메티칼" },
    NAD: { flag: "🇳🇦", name: "나미비아 달러" },
    NGN: { flag: "🇳🇬", name: "나이지리아 나이라" },
    NIO: { flag: "🇳🇮", name: "니카라과 코르도바" },
    NOK: { flag: "🇳🇴", name: "노르웨이 크로네" },
    NPR: { flag: "🇳🇵", name: "네팔 루피" },
    NZD: { flag: "🇳🇿", name: "뉴질랜드 달러" },
    OMR: { flag: "🇴🇲", name: "오만 리알" },
    PAB: { flag: "🇵🇦", name: "파나마 발보아" },
    PEN: { flag: "🇵🇪", name: "페루 솔" },
    PGK: { flag: "🇵🇬", name: "파푸아뉴기니 키나" },
    PHP: { flag: "🇵🇭", name: "필리핀 페소" },
    PKR: { flag: "🇵🇰", name: "파키스탄 루피" },
    PLN: { flag: "🇵🇱", name: "폴란드 즈워티" },
    PYG: { flag: "🇵🇾", name: "파라과이 과라니" },
    QAR: { flag: "🇶🇦", name: "카타르 리얄" },
    RON: { flag: "🇷🇴", name: "루마니아 레우" },
    RSD: { flag: "🇷🇸", name: "세르비아 디나르" },
    RUB: { flag: "🇷🇺", name: "러시아 루블" },
    RWF: { flag: "🇷🇼", name: "르완다 프랑" },
    SAR: { flag: "🇸🇦", name: "사우디아라비아 리얄" },
    SBD: { flag: "🇸🇧", name: "솔로몬 제도 달러" },
    SCR: { flag: "🇸🇨", name: "세이셸 루피" },
    SDG: { flag: "🇸🇩", name: "수단 파운드" },
    SEK: { flag: "🇸🇪", name: "스웨덴 크로나" },
    SGD: { flag: "🇸🇬", name: "싱가포르 달러" },
    SHP: { flag: "🇸🇭", name: "세인트헬레나 파운드" },
    SLE: { flag: "🇸🇱", name: "시에라리온 리온 (신)" },
    SLL: { flag: "🇸🇱", name: "시에라리온 리온" },
    SOS: { flag: "🇸🇴", name: "소말리아 실링" },
    SRD: { flag: "🇸🇷", name: "수리남 달러" },
    SSP: { flag: "🇸🇸", name: "남수단 파운드" },
    STN: { flag: "🇸🇹", name: "상투메 프린시페 도브라" },
    SYP: { flag: "🇸🇾", name: "시리아 파운드" },
    SZL: { flag: "🇸🇿", name: "에스와티니 릴랑게니" },
    THB: { flag: "🇹🇭", name: "태국 바트" },
    TJS: { flag: "🇹🇯", name: "타지키스탄 소모니" },
    TMT: { flag: "🇹🇲", name: "투르크메니스탄 마나트" },
    TND: { flag: "🇹🇳", name: "튀니지 디나르" },
    TOP: { flag: "🇹🇴", name: "통가 파앙가" },
    TRY: { flag: "🇹🇷", name: "튀르키예 리라" },
    TTD: { flag: "🇹🇹", name: "트리니다드 토바고 달러" },
    TVD: { flag: "🇹🇻", name: "투발루 달러" },
    TWD: { flag: "🇹🇼", name: "대만 달러" },
    TZS: { flag: "🇹🇿", name: "탄자니아 실링" },
    UAH: { flag: "🇺🇦", name: "우크라이나 흐리브냐" },
    UGX: { flag: "🇺🇬", name: "우간다 실링" },
    USD: { flag: "🇺🇸", name: "미국 달러" },
    UYU: { flag: "🇺🇾", name: "우루과이 페소" },
    UZS: { flag: "🇺🇿", name: "우즈베키스탄 숨" },
    VES: { flag: "🇻🇪", name: "베네수엘라 볼리바르" },
    VND: { flag: "🇻🇳", name: "베트남 동" },
    VUV: { flag: "🇻🇺", name: "바누아투 바투" },
    WST: { flag: "🇼🇸", name: "사모아 탈라" },
    XAF: { flag: "🌍", name: "중앙아프리카 CFA 프랑" },
    XCD: { flag: "🏝️", name: "동카리브 달러" },
    XCG: { flag: "🇨🇼", name: "카리브 길더" },
    XDR: { flag: "🏳️", name: "특별인출권 (SDR)" },
    XOF: { flag: "🌍", name: "서아프리카 CFA 프랑" },
    XPF: { flag: "🏝️", name: "CFP 프랑" },
    YER: { flag: "🇾🇪", name: "예멘 리알" },
    ZAR: { flag: "🇿🇦", name: "남아프리카공화국 랜드" },
    ZMW: { flag: "🇿🇲", name: "잠비아 콰차" },
    ZWL: { flag: "🇿🇼", name: "짐바브웨 달러" }
  };

  // 주요 통화 우선 정렬 (KRW 은 타겟 통화이므로 소스 목록에서 제외)
  const MAJOR_CODES = ["USD","EUR","JPY","CNY","GBP","HKD","AUD","CAD","CHF","SGD","TWD","THB","VND","NZD","IDR","MYR","PHP","INR","RUB","AED"];
  const CURRENCIES = (function () {
    const codes = Object.keys(CURRENCY_INFO).filter((c) => c !== "KRW");
    const majorSet = new Set(MAJOR_CODES);
    const majors = MAJOR_CODES.filter((c) => codes.includes(c));
    const others = codes.filter((c) => !majorSet.has(c)).sort();
    return [...majors, ...others].map((code) => ({ code, ...CURRENCY_INFO[code] }));
  })();

  // 소수 포맷터 (정밀도 유지 + KRW 표시용)
  // 결과값: 최소 2자리, 필요 시 최대 4자리까지 소수 표시
  const RESULT_FMT = new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  });
  // 환율 표시(1 X = ₩Y): 최소 2자리, 필요 시 최대 6자리까지 소수 표시
  const RATE_FMT = new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  });

  // ---------- 요소 ----------
  const select = document.getElementById("cur-select");
  const amountEl = document.getElementById("cur-amount");
  const unitEl = document.getElementById("cur-amount-unit");
  const resultNum = document.getElementById("cur-result-num");
  const resultRate = document.getElementById("cur-result-rate");
  const resultTime = document.getElementById("cur-result-time");
  const refreshBtn = document.getElementById("cur-refresh");
  const noteEl = document.getElementById("cur-note");

  // 상태
  let ratesUSD = null;   // { KRW: n, EUR: n, ... }
  let updatedAt = null;
  let selected = "USD";
  let inputStr = "";     // 사용자가 입력한 원본 문자열 (콤마 없음)

  // 통화 옵션 채우기
  CURRENCIES.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.code;
    opt.textContent = c.flag + "  " + c.code + " · " + c.name;
    select.appendChild(opt);
  });
  select.value = "USD";

  function updateUnitLabel() {
    unitEl.textContent = selected;
    // 입력 라벨도 갱신
    const label = document.getElementById("cur-amount-label");
    if (label) label.textContent = selected + " 금액 입력";
  }

  function displayAmount() {
    if (inputStr === "" || inputStr === ".") amountEl.firstChild.textContent = "0";
    else amountEl.firstChild.textContent = withCommas(inputStr);
  }

  function compute() {
    displayAmount();
    if (!ratesUSD || !ratesUSD.KRW) {
      resultNum.textContent = "0.00";
      resultRate.textContent = "환율 정보를 불러오는 중…";
      resultTime.textContent = "";
      return;
    }
    const amount = parseFloat(inputStr) || 0;
    // USD 기준 환율표에서 selected → KRW 로 환산
    // rate(selected → KRW) = rates[KRW] / rates[selected]
    const rateFromSel = ratesUSD[selected];
    const rateToKRW = ratesUSD.KRW;
    if (!rateFromSel || !rateToKRW) {
      resultNum.textContent = "0.00";
      resultRate.textContent = "지원되지 않는 통화입니다.";
      return;
    }
    // 부동소수점 정밀도 그대로 계산 (Math.round 사용 안 함)
    const perOne = rateToKRW / rateFromSel;   // 1 selected = ? KRW
    const converted = amount * perOne;

    // 정밀 소수 표시 (통화별 자릿수는 Intl.NumberFormat 옵션에 따름)
    resultNum.textContent = RESULT_FMT.format(converted);
    resultRate.textContent = "1 " + selected + " = ₩" + RATE_FMT.format(perOne);
    if (updatedAt) {
      const d = new Date(updatedAt);
      const h = d.getHours();
      const ampm = h < 12 ? "오전" : "오후";
      const h12 = h % 12 === 0 ? 12 : h % 12;
      const pad = (n) => (n < 10 ? "0" + n : "" + n);
      resultTime.textContent =
        d.getFullYear() + ". " + (d.getMonth() + 1) + ". " + d.getDate() + ". " +
        ampm + " " + h12 + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    }
  }

  async function fetchRates() {
    noteEl.textContent = "데이터: open.er-api.com · 참고용으로만 사용하세요 · 불러오는 중…";
    try {
      const res = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (data && data.result === "success" && data.rates) {
        ratesUSD = data.rates;
        updatedAt = data.time_last_update_utc || new Date().toUTCString();
        noteEl.textContent = "데이터: open.er-api.com · 참고용으로만 사용하세요";
        compute();
      } else {
        throw new Error("응답 형식 오류");
      }
    } catch (err) {
      noteEl.textContent = "데이터: open.er-api.com · 네트워크 오류 - 새로고침 버튼으로 재시도";
      resultRate.textContent = "환율 데이터를 불러올 수 없습니다.";
    }
  }

  // ---------- 이벤트 ----------
  select.addEventListener("change", () => {
    selected = select.value;
    updateUnitLabel();
    compute();
  });

  refreshBtn.addEventListener("click", () => {
    fetchRates();
  });

  document.querySelector(".cur-keys").addEventListener("click", (e) => {
    const btn = e.target.closest(".cur-key");
    if (!btn) return;
    const key = btn.dataset.key;
    if (key === "C") {
      inputStr = "";
    } else if (key === "BS") {
      inputStr = inputStr.slice(0, -1);
    } else if (key === ".") {
      if (!inputStr.includes(".")) inputStr = (inputStr === "" ? "0" : inputStr) + ".";
    } else if (key === "000") {
      if (inputStr === "") inputStr = "0";
      else if (inputStr.replace(".", "").length < 13) inputStr += "000";
    } else if (key === "00") {
      if (inputStr === "") inputStr = "0";
      else if (inputStr.replace(".", "").length < 14) inputStr += "00";
    } else if (/^[0-9]$/.test(key)) {
      if (inputStr === "0") inputStr = key;
      else if (inputStr.replace(".", "").length < 15) inputStr += key;
    }
    compute();
  });

  updateUnitLabel();
  compute();

  return { fetchRates };
})();

// ============================================================
// 7) 서비스워커 등록
// ============================================================
// 이 구조를 HTTPS 환경(GitHub Pages, Vercel, Netlify 등)에 배포하면
// 모바일 브라우저에서 자동으로 홈 화면 추가 프롬프트가 표시됩니다.
// iOS/Android 실제 기기에서 테스트하세요.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .catch((err) => {
        // 로컬 file:// 환경에서는 SW 등록이 실패할 수 있음 (정상)
        console.info("SW 등록 실패 또는 미지원 환경:", err && err.message);
      });
  });
}
