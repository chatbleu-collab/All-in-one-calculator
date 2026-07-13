/* ============================================================
   서비스워커 (Service Worker)
   - 오프라인 대응 및 정적 자원 캐싱
   - 캐시 키를 바꾸면 강제 갱신됩니다.
============================================================ */

// 캐시 이름 (버전을 올리면 사용자 브라우저에서 자동 갱신됩니다)
const CACHE_NAME = "olinwon-calc-v1.2.1";

// 캐시에 저장할 파일 목록 (상대경로: GitHub Pages 서브패스 대응)
const ASSETS = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// 설치 단계: 리소스 캐싱
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// 활성화 단계: 이전 캐시 삭제
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// fetch 이벤트:
// - 앱 정적 자원(GET 요청): 캐시 우선, 없으면 네트워크
// - 환율 API 요청: 네트워크 우선, 실패 시 캐시된 최신 응답
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // GET 요청만 처리
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 환율 API (open.er-api.com): 네트워크 우선
  if (url.hostname.includes("open.er-api.com")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // 성공 응답은 캐시에 저장 (오프라인 대비)
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 그 외 정적 자원: 캐시 우선
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // 동일 출처의 성공 응답만 캐시에 추가
          if (res && res.ok && url.origin === self.location.origin) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
