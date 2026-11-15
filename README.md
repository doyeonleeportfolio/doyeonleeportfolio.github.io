# Doyeon Lee — Portfolio

블랙 & 화이트, 얇은 선만 쓰는 정적 포트폴리오 사이트. GitHub Pages 로 운영합니다.

- 사이트: https://doyeonleeportfolio.github.io/
- 관리도구: https://doyeonleeportfolio.github.io/admin/

`main` 브랜치가 바뀌면 1분쯤 뒤 사이트가 새 버전이 됩니다. 따로 "배포"할 일은 없습니다.

---

## 관리도구

사이트와 같은 틀입니다 — 왼쪽 메뉴 **Works · Research · CV · About · Contact** 가 사이트 메뉴와 같은 방이고, 맨 위 이름을 누르면 **Home**(사이트 이름 · 검색용 소개)입니다. 화면 글은 사이트처럼 전부 영문입니다.

1. 처음 한 번만 로그인 — 로그인 화면의 **Create token ↗** 를 누르면 권한(`public_repo`)이 미리 채워진 GitHub 토큰 페이지가 열립니다. **Expiration** 만 고르고 **Generate token** → 나온 `ghp_…` 를 붙여넣기. 토큰은 그 브라우저에만 저장됩니다.
2. 고친 뒤 오른쪽 위 **Save** (또는 Ctrl+S). 저장 한 번 = GitHub 커밋 한 번 = 사이트 반영. 상단에 `Live on the site ✓` 가 뜨면 끝.
3. 다른 기기·탭에서 먼저 저장된 내용이 있으면 덮어쓸지 묻습니다.

### 파일 규격

| 종류 | 형식 | 비고 |
|---|---|---|
| 이미지 | jpg · png · webp | 긴 변 2500px, 5MB 이하 권장 |
| 영상 | mp4 (H.264) | **한 파일 38MB 까지** (GitHub API 한계). 넘으면 압축하거나 YouTube·Vimeo 링크로 |
| 3D | .glb | Blender → Export → glTF 2.0 |
| PDF | pdf | 페이지마다 이미지로 바뀌어 상세 화면에 2열로 펼쳐짐 |

큰 영상 압축 (1080p 2분 ≈ 33MB):

```
ffmpeg -y -i in.mp4 -c:v libx264 -b:v 2000k -pass 1 -an -f mp4 NUL
ffmpeg -i in.mp4 -c:v libx264 -b:v 2000k -pass 2 -c:a aac -b:a 128k -movflags +faststart out.mp4
```

파일 이름은 영문·숫자만 남습니다 (관리도구가 자동으로 바꿉니다).

---

## 되돌리기

모든 저장이 커밋으로 남습니다. GitHub 저장소 → `content/data.js` → **History** 에서 원하는 시점으로 되돌리면 됩니다.

---

## 폴더 구조

```
index.html          사이트 본체
css/, js/           디자인과 동작
lib/                three.js (3D 표시)
assets/             폰트(Pretendard), 홈 문양, 공유 이미지
content/data.js     ★ 모든 글·목록 (관리도구가 고침)
content/media/      ★ 이미지·영상·3D 파일
admin/              관리도구
```

---

## 내 도메인 연결 (선택)

1. 도메인 구매 → 저장소 Settings → **Pages** → Custom domain 입력
2. DNS: 루트는 A 레코드 `185.199.108.153` `185.199.109.153` `185.199.110.153` `185.199.111.153`, `www` 는 CNAME `doyeonleeportfolio.github.io`
3. 연결되면 **Enforce HTTPS** 체크
4. `index.html` 의 canonical·og·JSON-LD 주소, `robots.txt`, `sitemap.xml` 을 새 도메인으로 바꾸고 Search Console 에 새 속성 추가

저장소는 **공개로 유지**해야 합니다 — 무료 GitHub Pages 는 공개 저장소에서만 동작합니다 (토큰·비밀번호는 저장소에 없습니다).
