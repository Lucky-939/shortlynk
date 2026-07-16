import type { Config } from "jest";

const config: Config = {
  testEnvironment: "jsdom",
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", {
      tsconfig: {
        jsx: "react-jsx",
        esModuleInterop: true,
        moduleResolution: "node",
      },
    }],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "\\.(css|less|scss|sass)$": "<rootDir>/src/__mocks__/fileMock.js",
    "\\.(jpg|jpeg|png|svg|gif|webp)$": "<rootDir>/src/__mocks__/fileMock.js",
  },
  testMatch: ["**/__tests__/**/*.test.(ts|tsx)"],
  // setupFilesAfterEnv runs after the test framework is installed in the env,
  // which is the right time to import jest-dom's custom matchers.
  setupFilesAfterEnv: ["<rootDir>/src/__mocks__/jest.setup.ts"],
};

export default config;
