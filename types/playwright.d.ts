declare module "playwright" {
  export interface Locator {
    [key: string]: any;
    innerText(options?: any): Promise<string>;
    getAttribute(name: string, options?: any): Promise<string | null>;
    count(): Promise<number>;
    first(): Locator;
    nth(index: number): Locator;
    click(options?: any): Promise<void>;
    fill(value: string, options?: any): Promise<void>;
  }

  export interface Page {
    [key: string]: any;
    goto(url: string, options?: any): Promise<any>;
    url(): string;
    locator(selector: any, options?: any): Locator;
    waitForTimeout(timeout: number): Promise<void>;
    waitForSelector(selector: any, options?: any): Promise<any>;
    evaluate<T = any>(pageFunction: any, arg?: any): Promise<T>;
    content(): Promise<string>;
    close(options?: any): Promise<void>;
  }

  export interface BrowserContext {
    [key: string]: any;
    newPage(): Promise<Page>;
    cookies(urls?: string | string[]): Promise<any[]>;
    addCookies(cookies: any[]): Promise<void>;
    close(): Promise<void>;
  }

  export interface Browser {
    [key: string]: any;
    newContext(options?: any): Promise<BrowserContext>;
    close(): Promise<void>;
  }

  export type BrowserContextOptions = any;
}

declare module "playwright-extra" {
  export const chromium: any;
}

declare module "puppeteer-extra-plugin-stealth" {
  export default function stealth(): any;
}
