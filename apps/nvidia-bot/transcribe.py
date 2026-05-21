#!/usr/bin/env python3
import sys
import os
import json
from nvidia_riva.client import ASRServiceAsyncClient
from nvidia_riva.proto import audio_pb2
import asyncio

async def transcribe_audio(audio_file_path, api_key):
    """Transcribe audio file using NVIDIA Riva ASR"""
    try:
        # Connexion au serveur Riva
        auth_metadata = [("authorization", f"Bearer {api_key}")]
        client = ASRServiceAsyncClient(uri="grpc.nvcf.nvidia.com:443", ssl=True)

        # Lire le fichier audio
        with open(audio_file_path, 'rb') as f:
            audio_data = f.read()

        # Créer la requête audio
        config = audio_pb2.RecognitionConfig(
            encoding=audio_pb2.LINEAR_PCM,
            sample_rate_hertz=16000,
            language_code="fr-FR",
            max_alternatives=1,
            enable_automatic_punctuation=True,
        )

        request = audio_pb2.RecognizeRequest(
            config=config,
            audio=audio_pb2.AudioContent(content=audio_data)
        )

        # Transcrire
        response = await client.Recognize(request, metadata=auth_metadata)

        # Extraire le texte
        if response.results:
            transcript = response.results[0].alternatives[0].transcript
            result = {"success": True, "text": transcript}
        else:
            result = {"success": False, "text": "(aucun texte détecté)"}

        print(json.dumps(result))

    except Exception as e:
        error_result = {"success": False, "error": str(e)}
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: python transcribe.py <audio_file> <api_key>"}))
        sys.exit(1)

    audio_file = sys.argv[1]
    api_key = sys.argv[2]

    if not os.path.exists(audio_file):
        print(json.dumps({"success": False, "error": f"File not found: {audio_file}"}))
        sys.exit(1)

    asyncio.run(transcribe_audio(audio_file, api_key))
