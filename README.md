**Сборка AppImage**

из под wsl:

очищаем кеши
```
rm -rf dist node_modules package-lock.json
```
собираем
```
docker run --rm -it   -v "$(pwd)":/project   -v ~/.cache/electron-builder:/home/builder/.cache/electron-builder   -w /project   node:18-bullseye   bash -lc "\
apt update && \
apt install -y git python3 make g++ squashfs-tools && \
npm install && \
npx electron-builder --linux --x64 \
"
```