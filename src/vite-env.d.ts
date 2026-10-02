/// <reference types="vite/client" />

declare const __GIT_COMMIT__: string | undefined;

declare module "*.md?raw" {
  const content: string;
  export default content;
}
