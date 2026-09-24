"""Run a single-image inspection and create a reviewable HTML result page."""

from __future__ import annotations

import argparse
from html import escape
import json
from pathlib import Path
from shutil import copyfile

from PIL import Image, ImageDraw, ImageFont

from pcb_inspection.dataset import CLASS_NAMES


COLORS = ("#e53935", "#fb8c00", "#8e24aa", "#00897b", "#1e88e5", "#6d4c41")


def inspect(model_path: Path, image_path: Path, output: Path, *, confidence: float, image_size: int) -> dict:
    from ultralytics import YOLO

    model_path = model_path.resolve(strict=True)
    image_path = image_path.resolve(strict=True)
    output = output.resolve()
    if not 0 < confidence < 1:
        raise ValueError("confidence must be in (0, 1)")
    output.mkdir(parents=True, exist_ok=True)
    model = YOLO(str(model_path))
    prediction = model.predict(
        source=str(image_path), conf=confidence, iou=0.7, imgsz=image_size, device="cpu", verbose=False
    )[0]
    with Image.open(image_path) as source:
        canvas = source.convert("RGB")
    original_name = "original" + image_path.suffix.lower()
    copyfile(image_path, output / original_name)
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    detections = []
    for kind, score, coords in zip(
        prediction.boxes.cls.tolist(), prediction.boxes.conf.tolist(), prediction.boxes.xyxy.tolist()
    ):
        class_id = int(kind)
        if not 0 <= class_id < len(CLASS_NAMES):
            raise ValueError(f"unexpected model class: {class_id}")
        box = [round(float(value), 1) for value in coords]
        label = f"{CLASS_NAMES[class_id]} {float(score):.2f}"
        color = COLORS[class_id]
        draw.rectangle(box, outline=color, width=3)
        text_x, text_y = box[0], max(0, box[1] - 16)
        bounds = draw.textbbox((text_x, text_y), label, font=font)
        draw.rectangle(bounds, fill=color)
        draw.text((text_x, text_y), label, fill="white", font=font)
        detections.append({"class": CLASS_NAMES[class_id], "confidence": round(float(score), 4), "xyxy": box})
    canvas.save(output / "inspection.png")

    # 검출이 없어도 정상 판정으로 바꾸지 않고 사람의 검토 대상으로 남깁니다.
    record = {
        "input_image": str(image_path),
        "model": str(model_path),
        "confidence_threshold": confidence,
        "image_size": image_size,
        "detections": detections,
        "inference_ms": float(prediction.speed["inference"]),
        "decision": "review_detected_regions" if detections else "no_detection_manual_review_required",
    }
    (output / "inspection.json").write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    rows = "".join(
        f"<tr><td>{index}</td><td>{escape(item['class'])}</td><td>{item['confidence']:.3f}</td><td>{escape(str(item['xyxy']))}</td></tr>"
        for index, item in enumerate(detections, start=1)
    )
    if not rows:
        rows = '<tr><td colspan="4">검출 없음 · 정상 판정이 아니며 사람이 확인해야 합니다.</td></tr>'
    html = f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PCB 최종검사 AI · 검토 화면</title>
<style>
body{{font-family:system-ui,sans-serif;background:#f5f7fa;color:#17212f;max-width:1200px;margin:32px auto;padding:0 18px}}
h1{{font-size:1.7rem}} .note{{background:#fff3d6;padding:14px;border-left:4px solid #e7a100}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin:24px 0}}
figure{{margin:0;background:#fff;padding:14px;border:1px solid #d7dde6;border-radius:8px}}
img{{width:100%;height:auto}} figcaption{{font-weight:700;margin-bottom:10px}}
table{{border-collapse:collapse;width:100%;background:white}}td,th{{border:1px solid #d7dde6;padding:8px;text-align:left}}
th{{background:#eaf0f7}} small{{color:#506079}}
</style></head><body>
<h1>PCB 최종검사 AI · 검토 화면</h1>
<p class="note">공개 연구 데이터로 만든 실험용 모델입니다. 검출 결과는 사람의 검토 대상이며, 실제 pcb-manufacturer 현장 성능이나 자동 합격 판정을 뜻하지 않습니다.</p>
<p><strong>이미지:</strong> {escape(image_path.name)} · <strong>검출:</strong> {len(detections)}건 · <strong>신뢰도 임계값:</strong> {confidence:.2f} · <strong>추론:</strong> {record['inference_ms']:.1f} ms</p>
<div class="grid"><figure><figcaption>원본</figcaption><img src="{escape(original_name)}" alt="원본 PCB 이미지"></figure>
<figure><figcaption>AI 검출 위치</figcaption><img src="inspection.png" alt="결함 검출 결과"></figure></div>
<h2>검출 목록</h2><table><thead><tr><th>#</th><th>결함 종류</th><th>신뢰도</th><th>좌표</th></tr></thead><tbody>{rows}</tbody></table>
<p><small>모델: {escape(model_path.name)} · 입력 크기: {image_size}px · 자세한 값: inspection.json</small></p>
</body></html>"""
    (output / "index.html").write_text(html, encoding="utf-8")
    return record


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=Path("reports/inspection-demo"))
    parser.add_argument("--conf", type=float, default=0.25)
    parser.add_argument("--imgsz", type=int, default=320)
    args = parser.parse_args()
    result = inspect(args.model, args.image, args.output, confidence=args.conf, image_size=args.imgsz)
    print(json.dumps({"detections": len(result["detections"]), "decision": result["decision"], "output": str(args.output.resolve())}, ensure_ascii=False))


if __name__ == "__main__":
    main()
