FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html coop-bubbles.js support.js /usr/share/nginx/html/
# Stamp the build identity into the game before hashing it: the stamp is part of the
# content, so every rebuild produces a fresh ?v= and the tag drawn in the corner always
# matches the bundle the browser actually fetched.
RUN build_stamp="$(date -u '+%Y-%m-%d %H:%M UTC')" \
    && sed -i "s/__BUILD_STAMP__/${build_stamp}/g" /usr/share/nginx/html/coop-bubbles.js \
    && ! grep -q '__BUILD_STAMP__' /usr/share/nginx/html/coop-bubbles.js

RUN support_version="$(sha256sum /usr/share/nginx/html/support.js | cut -c1-12)" \
    && game_version="$(sha256sum /usr/share/nginx/html/coop-bubbles.js | cut -c1-12)" \
    && sed -i \
        -e "s/__SUPPORT_VERSION__/${support_version}/g" \
        -e "s/__GAME_VERSION__/${game_version}/g" \
        /usr/share/nginx/html/index.html \
    && ! grep -q '__[A-Z_]*_VERSION__' /usr/share/nginx/html/index.html

EXPOSE 80
