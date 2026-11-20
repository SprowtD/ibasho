#!/usr/bin/env python3
"""Write down what is said in a sound or video file, with times, using a Whisper that is installed on THIS computer.
Nothing is sent anywhere and nothing is paid for. (The first run of a model size downloads that model once, free.)

  hear.py <file> [--to en] [--lang ja] [--model small]

  --to en     write it in English whatever language is spoken (Whisper's own translation); left out = the language spoken
  --lang xx   the language spoken, when you know it (left out = Whisper works it out)
  --model     tiny | base | small | medium | large-v3 (default small: about real time on a plain processor)

Prints one line of JSON: {"language", "model", "engine", "segments": [{"start", "end", "text"}]}
Needs ONE of:  pip install faster-whisper   (quicker on a processor)   or   pip install openai-whisper
"""
import json
import sys


def main(argv):
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(__doc__); return 0
    opt = lambda k, d=None: argv[argv.index("--" + k) + 1] if "--" + k in argv and argv.index("--" + k) + 1 < len(argv) else d
    src, model, lang, task = argv[1], opt("model", "small"), opt("lang"), "translate" if opt("to") == "en" else "transcribe"
    try:
        from faster_whisper import WhisperModel
        m = WhisperModel(model, device="cpu", compute_type="int8")
        segs, info = m.transcribe(src, task=task, language=lang or None, vad_filter=True)
        out = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segs]
        print(json.dumps({"language": info.language, "model": model, "engine": "faster-whisper", "segments": [s for s in out if s["text"]]})); return 0
    except ImportError:
        pass
    try:
        import whisper
    except ImportError:
        print("No Whisper is installed for this Python. Install one (free): pip install faster-whisper", file=sys.stderr); return 3
    r = whisper.load_model(model).transcribe(src, task=task, language=lang or None, fp16=False)
    out = [{"start": round(s["start"], 2), "end": round(s["end"], 2), "text": s["text"].strip()} for s in r.get("segments", [])]
    print(json.dumps({"language": r.get("language", ""), "model": model, "engine": "whisper", "segments": [s for s in out if s["text"]]})); return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
