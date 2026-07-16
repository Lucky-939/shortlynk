/**
 * CopyButton.test.tsx
 *
 * Tests the copy-to-clipboard confirmation state:
 *   - clicking the button shows "Copied!" immediately
 *   - after 2 seconds it reverts to the default label
 *   - calls navigator.clipboard.writeText with the correct text
 */

import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import CopyButton from "@/components/CopyButton";

// ── Mock the Clipboard API ────────────────────────────────────────────────────

const mockWriteText = jest.fn();

beforeEach(() => {
  mockWriteText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: mockWriteText },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CopyButton — confirmation state", () => {
  it("renders the default label", () => {
    render(<CopyButton text="https://sho.rt/abc123" />);
    expect(screen.getByRole("button")).toHaveTextContent("Copy");
  });

  it("uses a custom label when provided", () => {
    render(<CopyButton text="https://sho.rt/abc123" label="Copy link" />);
    expect(screen.getByRole("button")).toHaveTextContent("Copy link");
  });

  it("calls navigator.clipboard.writeText with the provided text on click", async () => {
    render(<CopyButton text="https://sho.rt/abc123" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(mockWriteText).toHaveBeenCalledTimes(1);
    expect(mockWriteText).toHaveBeenCalledWith("https://sho.rt/abc123");
  });

  it("shows 'Copied!' immediately after clicking", async () => {
    jest.useFakeTimers();
    render(<CopyButton text="https://sho.rt/abc123" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    expect(screen.getByRole("button")).toHaveTextContent("Copied!");
  });

  it("reverts to the default label after 2 seconds", async () => {
    jest.useFakeTimers();
    render(<CopyButton text="https://sho.rt/abc123" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    // Still showing "Copied!" at 1999 ms
    act(() => { jest.advanceTimersByTime(1999); });
    expect(screen.getByRole("button")).toHaveTextContent("Copied!");

    // Reverts at 2000 ms
    act(() => { jest.advanceTimersByTime(1); });
    expect(screen.getByRole("button")).toHaveTextContent("Copy");
  });

  it("updates aria-label to 'Copied!' during confirmation", async () => {
    jest.useFakeTimers();
    render(<CopyButton text="https://sho.rt/abc123" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Copied!");
  });

  it("applies success border/text colour class during confirmation", async () => {
    jest.useFakeTimers();
    render(<CopyButton text="https://sho.rt/abc123" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    const btn = screen.getByRole("button");
    // The button should have the success colour classes applied
    expect(btn.className).toContain("border-success");
    expect(btn.className).toContain("text-success");
  });
});
