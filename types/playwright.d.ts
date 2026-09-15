declare module "playwright" {
  export interface Response {
    url(): string;
    status(): number;
    json(): Promise<unknown>;
    text(): Promise<string>;
  }

  export interface Cookie {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string;
    [key: string]: any;
  }

  export interface Locator {
    [key: string]: any;
    locator(selector: string, options?: any): Locator;
    innerText(options?: any): Promise<string>;
    getAttribute(name: string, options?: any): Promise<string | null>;
    count(): Promise<number>;
    first(): Locator;
    nth(index: number): Locator;
    click(options?: any): Promise<void>;
    fill(value: string, options?: any): Promise<void>;
    isVisible(options?: any): Promise<boolean>;
    evaluate<R, A>(pageFunction: (element: HTMLElement, arg: A) => R | Promise<R>, arg: A): Promise<R>;
    evaluate<R>(pageFunction: (element: HTMLElement) => R | Promise<R>): Promise<R>;
  }

  export interface Page {
    [key: string]: any;
    goto(url: string, options?: any): Promise<any>;
    url(): string;
    locator(selector: any, options?: any): Locator;
    context(): BrowserContext;
    on(event: "response", listener: (response: Response) => void | Promise<void>): void;
    on(event: string, listener: (value: any) => void | Promise<void>): void;
    waitForTimeout(timeout: number): Promise<void>;
    waitForSelector(selector: any, options?: any): Promise<any>;
    evaluate<R, A>(pageFunction: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
    evaluate<R>(pageFunction: () => R | Promise<R>): Promise<R>;
    content(): Promise<string>;
    close(options?: any): Promise<void>;
  }

  export interface BrowserContext {
    [key: string]: any;
    newPage(): Promise<Page>;
    cookies(urls?: string | string[]): Promise<Cookie[]>;
    addCookies(cookies: Cookie[]): Promise<void>;
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
