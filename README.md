# 청약노트 — 자동 연동 버전 배포 안내

청약홈(공공데이터) API와 자동으로 연결되는 버전입니다.
페이지를 열면 청약홈의 분양 단지가 자동으로 불러와집니다.

## 폴더 구성
```
cheongyak-note/
├─ index.html              ← 사이트 본체
├─ netlify.toml            ← Netlify 설정
└─ netlify/functions/apt.js ← 청약홈 API 중계 함수
```

## 배포 순서 (요약)
1. 이 폴더를 GitHub 저장소에 올린다.
2. Netlify에서 그 GitHub 저장소를 연결해 배포한다.
3. Netlify 사이트 설정 → Environment variables 에 인증키를 넣는다.
   - Key:   APPLYHOME_KEY
   - Value: (공공데이터포털에서 받은 일반 인증키)
4. 배포가 끝나면 사이트 주소로 접속해서 단지가 자동으로 뜨는지 확인한다.

## 중요
- 인증키(APPLYHOME_KEY)는 코드에 직접 넣지 말고 반드시 환경변수로 넣을 것.
- 함수 호출 경로: /api/apt?type=apt&page=1&perPage=300
  - type=apt    : 아파트 분양정보
  - type=remain : 무순위/잔여세대
  - type=urban  : 오피스텔/도시형 등
- 단지 상세의 입지분석·평형 등 '우리만의 정보'는 index.html의 DATA에 직접 넣은 단지에만 표시됨.
  청약홈 API로 들어온 단지는 공식 정보(일정·세대수·건설사 등)만 표시됨.
