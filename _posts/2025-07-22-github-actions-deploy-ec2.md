---
title: "GitHub Actions로 Spring Boot 애플리케이션을 AWS EC2에 배포하기"
date: 2025-07-22 10:30:00 +0900
categories: [DevOps]
tags: [github-actions, ci-cd, spring-boot, aws, ec2]
mermaid: true
image:
  path: /assets/img/posts/github-actions-deploy-ec2.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnDEzZIHFJ5L+lDSNgrnjNR5PrVsCWKAvOkZONxxmtKTRCkbN5nQZHHWsuCXyp0kIztOcVsT69HLB5YiIwMDmkIxW+8aaaKKbASiiikB//2Q=="
  alt: GitHub Actions로 EC2 배포
---

## 수동 배포에 지쳤다면

코드를 고칠 때마다 직접 빌드하고, jar를 EC2에 scp로 올리고, SSH로 들어가 재시작하는 과정은 금방 지칩니다. 실수도 잦죠. **GitHub Actions**로 이 과정을 자동화하면, `main`에 푸시만 하면 배포까지 끝납니다.

## 전체 흐름

```mermaid
flowchart LR
    P["main 브랜치 push"] --> B["GitHub Actions<br/>빌드 + 테스트"]
    B --> J["jar 생성"]
    J --> T["scp로 EC2 전송"]
    T --> R["SSH로 재시작"]
    R --> S["서비스 반영"]
```

## 준비: Secrets 등록

EC2 접속 정보를 코드에 두면 안 되니, 레포 **Settings → Secrets and variables → Actions**에 등록합니다.

- `EC2_HOST`: EC2 퍼블릭 IP/도메인
- `EC2_USER`: 접속 계정(예: `ubuntu`)
- `EC2_SSH_KEY`: EC2 접속용 **프라이빗 키** 전체 내용

> EC2 보안 그룹의 SSH(22) 인바운드는 [GitHub Actions 러너 IP 또는 제한된 대역](/posts/aws-security-group-source/)으로 관리하는 게 안전합니다. (러너 IP가 유동적이라 운영에선 배스천/SSM을 쓰기도 합니다.)
{: .prompt-tip }

## 워크플로우 작성

```yaml
# .github/workflows/deploy.yml
name: Deploy to EC2

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK 21
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'

      - name: Build with Gradle
        run: ./gradlew clean build -x test   # 필요 시 테스트 포함

      - name: Copy jar to EC2
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ${{ secrets.EC2_USER }}
          key: ${{ secrets.EC2_SSH_KEY }}
          source: "build/libs/*.jar"
          target: "/home/ubuntu/app"
          strip_components: 2

      - name: Restart application
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ${{ secrets.EC2_USER }}
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            sudo systemctl restart myapp
```

## 무중단에 가깝게: systemd 서비스

`nohup java -jar ...` 대신 **systemd 서비스**로 등록하면 재시작·로그·부팅 자동 실행이 깔끔합니다.

```ini
# /etc/systemd/system/myapp.service
[Unit]
Description=My Spring Boot App
After=network.target

[Service]
User=ubuntu
ExecStart=/usr/bin/java -jar /home/ubuntu/app/app.jar
SuccessExitStatus=143
Restart=always

[Install]
WantedBy=multi-user.target
```

워크플로우의 마지막 단계가 `systemctl restart myapp`로 새 jar를 반영합니다.

## 한 단계 더 나아가려면

- **빌드 캐시**(`actions/cache` 또는 setup-java의 gradle 캐시)로 빌드 시간 단축.
- 진짜 무중단이 필요하면 **로드밸런서 + 인스턴스 2대 롤링 배포**나 **Docker 이미지 + ECR/ECS**로 발전.
- 테스트를 워크플로우에 포함해 **실패 시 배포 중단**(품질 게이트).

## 정리

- `main` push → **빌드 → scp 전송 → SSH 재시작**을 GitHub Actions로 자동화.
- 접속 정보는 **Secrets**로 안전하게 관리.
- 실행은 **systemd 서비스**로 두면 재시작/로그/자동기동이 깔끔.
- 다음 단계는 캐시·테스트 게이트·롤링 배포·컨테이너화.
