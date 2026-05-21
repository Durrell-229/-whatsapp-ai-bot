#!/usr/bin/env python3
import sys
import json
import os
from openai import OpenAI

def transcribe_audio(audio_file_path, api_key):
    """Transcribe audio using OpenAI Whisper"""
    try:
        if not os.path.exists(audio_file_path):
            return {"success": False, "error": f"File not found: {audio_file_path}"}

        client = OpenAI(api_key=api_key)

        with open(audio_file_path, 'rb') as f:
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                language="fr"
            )

        return {"success": True, "text": transcript.text}

    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: python transcribe.py <audio_file> <api_key>"}))
        sys.exit(1)

    audio_file = sys.argv[1]
    api_key = sys.argv[2]

    result = transcribe_audio(audio_file, api_key)
    print(json.dumps(result))
    sys.exit(0 if result['success'] else 1)
