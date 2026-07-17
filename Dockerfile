FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html coop-bubbles.js support.js /usr/share/nginx/html/
RUN support_version="$(sha256sum /usr/share/nginx/html/support.js | cut -c1-12)" \
    && game_version="$(sha256sum /usr/share/nginx/html/coop-bubbles.js | cut -c1-12)" \
    && sed -i \
        -e "s/__SUPPORT_VERSION__/${support_version}/g" \
        -e "s/__GAME_VERSION__/${game_version}/g" \
        /usr/share/nginx/html/index.html \
    && ! grep -q '__[A-Z_]*_VERSION__' /usr/share/nginx/html/index.html

EXPOSE 80
