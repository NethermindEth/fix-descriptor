FROM public.ecr.aws/lambda/nodejs:20

RUN (dnf -y install java-17-amazon-corretto-devel findutils || yum -y install java-17-amazon-corretto-devel findutils) \
  && (dnf clean all || yum clean all)

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /var/task
COPY . .

WORKDIR /var/task/apps/lambda
ENV NODE_ENV=development
ENV CI=true
RUN pnpm install


# Ensure generated codecs importing "agrona" resolve to the vendored agrona-ts inside ts-sdk
RUN ln -sfn /var/task/apps/lambda/node_modules/@fixdescriptorkit/ts-sdk/src/sbe/agrona-ts /var/task/apps/lambda/node_modules/agrona

RUN ln -s /var/task/apps/lambda/node_modules /var/task/node_modules


CMD ["apps/lambda/src/lambda-handler.handler"]
