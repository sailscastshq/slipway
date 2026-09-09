ARG SAILS_FIXTURE_BASE=slipway-local:latest
FROM ${SAILS_FIXTURE_BASE}
RUN cd /app && npm install --no-save --ignore-scripts sails-hook-content@0.0.13
WORKDIR /fixture
RUN ln -s /app/node_modules /fixture/node_modules
COPY . /fixture/
ENV NODE_ENV=development
ENTRYPOINT ["node"]
CMD ["-e", "setInterval(() => {}, 1000)"]
