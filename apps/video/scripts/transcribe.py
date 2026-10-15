"""音声を書き起こし、単語ごとの時刻を JSON で書き出す（faster-whisper）。

  python3 transcribe.py <音声> <出力の JSON>

出力：{"duration": 秒, "words": [{"text": "…", "start": 秒, "end": 秒}, ...]}
モデルは環境変数 WHISPER_MODEL（既定 small）。CPU で int8 で動かす。
"""
import json
import os
import sys

from faster_whisper import WhisperModel


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    model = WhisperModel(os.environ.get("WHISPER_MODEL", "small"), device="cpu", compute_type="int8")
    segments, info = model.transcribe(src, language="ja", word_timestamps=True, vad_filter=False, condition_on_previous_text=False)
    words = []
    for seg in segments:
        if seg.words:
            for w in seg.words:
                words.append({"text": w.word, "start": float(w.start), "end": float(w.end)})
        else:
            # 単語の時刻が取れなかった区間は、区間ぜんぶを1語として扱う
            words.append({"text": seg.text, "start": float(seg.start), "end": float(seg.end)})
    with open(dst, "w", encoding="utf-8") as f:
        json.dump({"duration": float(info.duration), "words": words}, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
