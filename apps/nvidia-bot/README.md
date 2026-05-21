# 🤖 Bot WhatsApp × NVIDIA NIM

Bot WhatsApp intelligent propulsé par l'IA NVIDIA NIM.

## Configuration

1. Copiez le fichier d'exemple :
   ```
   copy .env.example .env
   ```

2. Éditez `.env` et renseignez votre clé API NVIDIA :
   ```
   NVIDIA_API_KEY=nvapi-VOTRE_CLE_ICI
   ```

   Obtenez votre clé sur : https://build.nvidia.com/explore/discover

## Démarrage

Depuis la racine du monorepo :
```bash
pnpm build
pnpm --filter "@open-wa/nvidia-bot" start
```

Un QR code s'affichera dans le terminal ou dans le navigateur.
Scannez-le avec WhatsApp sur votre téléphone.

## Commandes disponibles

| Commande | Description |
|----------|-------------|
| `!aide` | Afficher l'aide |
| `!reset` | Effacer l'historique de conversation |
| `!modele` | Voir le modèle IA actif |

## Modèles NVIDIA NIM supportés

- `meta/llama-3.1-70b-instruct` (défaut)
- `meta/llama-3.1-8b-instruct`
- `mistralai/mistral-7b-instruct-v0.3`
- `nvidia/llama-3.1-nemotron-70b-instruct`
- `google/gemma-2-9b-it`

Changez le modèle via `NVIDIA_MODEL=...` dans `.env`.
