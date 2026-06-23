---
title: "운영체제 가상 메모리: 스왑 파일 생성 및 관리 방법"
date: 2024-12-31 14:00:00 +0900
categories: [Infra]
tags: [linux, virtual-memory, swap, operating-system]
mermaid: true
image:
  path: /assets/img/posts/linux-virtual-memory-swap.png
  lqip: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAARACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDn2jLMxA70wwvnpSySMCyg8ZqIk+tQloDHxxmSZY+hJxWvc+HzBA8nmglRnFY8MnlTLJ12nNbd14hSe2eMQkMwxnNVYDEl/wBY31phoooWwMSkooqhH//Z"
  alt: 리눅스 가상 메모리와 스왑
---

## 메모리 부족으로 프로세스가 죽었다

작은 EC2 인스턴스에서 빌드를 돌리거나 메모리를 많이 쓰는 작업을 하다 보면, OOM(Out Of Memory)으로 프로세스가 강제 종료되는 일이 있습니다. 이때 임시방편이자 안전망이 되는 게 **스왑(swap)** 입니다. 그 배경인 **가상 메모리**부터 짚어봅니다.

## 가상 메모리와 스왑

운영체제는 프로세스에게 **가상 주소 공간**을 주고, 이를 물리 메모리(RAM)에 매핑합니다. 물리 메모리가 부족하면, 당장 안 쓰는 페이지를 디스크의 **스왑 공간**으로 내보내(swap out) RAM을 비웁니다. 필요해지면 다시 가져옵니다(swap in).

```mermaid
flowchart LR
    P["프로세스<br/>가상 메모리"] --> R["RAM (물리 메모리)"]
    R -->|"부족 시 안 쓰는 페이지 내보냄(swap out)"| S["Swap (디스크)"]
    S -->|"필요 시 다시 적재(swap in)"| R
```

- 장점: RAM이 부족해도 **프로세스가 죽지 않고 버틴다**(OOM 방지 안전망).
- 단점: 디스크는 RAM보다 **수백~수천 배 느려서**, 스왑을 많이 쓰면 성능이 급락합니다(스래싱). 스왑은 "여유"이지 "RAM 대체"가 아닙니다.

## 스왑 파일 만들기

스왑은 별도 파티션 또는 **스왑 파일**로 만들 수 있습니다. 파일 방식이 간편합니다(예: 2GB).

```bash
# 1) 2GB 파일 생성
sudo fallocate -l 2G /swapfile
# (fallocate가 안 되면) sudo dd if=/dev/zero of=/swapfile bs=1M count=2048

# 2) 권한 설정 (소유자만 접근)
sudo chmod 600 /swapfile

# 3) 스왑 영역으로 포맷
sudo mkswap /swapfile

# 4) 스왑 활성화
sudo swapon /swapfile

# 확인
swapon --show
free -h
```

## 재부팅 후에도 유지하기

`swapon`은 일시적입니다. 부팅 시 자동 적용하려면 `/etc/fstab`에 등록합니다.

```bash
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## swappiness 튜닝

`swappiness`는 "얼마나 적극적으로 스왑을 쓸지"를 0~100으로 정합니다(높을수록 스왑 적극 사용).

```bash
cat /proc/sys/vm/swappiness        # 기본값 확인 (보통 60)
sudo sysctl vm.swappiness=10       # 서버는 낮게 (RAM 우선, 스왑은 최후)
```

서버 애플리케이션은 보통 **낮은 값(10 등)** 으로 두어 스왑을 최소화하고 RAM을 우선 쓰게 합니다. 영구 적용하려면 `/etc/sysctl.conf`에 `vm.swappiness=10`을 추가합니다.

## 주의점

- 스왑은 **안전망**이지 RAM 부족의 근본 해결책이 아닙니다. 상습적으로 스왑을 쓴다면 RAM 증설이나 메모리 사용 최적화가 답입니다.
- **SSD**에 스왑을 두면 쓰기 수명에 약간 영향이 있을 수 있으나, 적당량이면 대체로 괜찮습니다.

## 정리

- 가상 메모리는 RAM이 부족할 때 디스크의 **스왑**으로 페이지를 내보내 버틴다.
- 스왑 파일: `fallocate → chmod 600 → mkswap → swapon`, `/etc/fstab`으로 영구화.
- **swappiness**를 낮춰 RAM 우선. 스왑은 안전망일 뿐, 상습 사용은 RAM 부족 신호.
