/* 판 정보와 배포 설정. 배포 때 배포 스크립트가 배포 폴더 사본에서 이 파일을 덮어쓴다. 저장소에는 빈 기본값만 둔다. */
window.KCP = window.KCP || {};
KCP.BUILD = { label: "개발판", sha: "", date: "", feedbackUrl: "", supabase: null };
