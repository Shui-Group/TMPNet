FROM busybox:1.36

COPY data/raw/20260627_web_data/best_structure /seed/structure-assets

CMD ["sh", "-c", "if [ ! -f /structure-assets/.seeded ]; then cp -a /seed/structure-assets/. /structure-assets/ && touch /structure-assets/.seeded; fi"]
