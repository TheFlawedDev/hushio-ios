import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PhoneHeader } from "./PhoneHeader";

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty("--phone-status-bg");
});

describe("PhoneHeader", () => {
  it("sets page titles in the display face", () => {
    render(<PhoneHeader title="Library" />);
    const title = screen.getByRole("heading", { name: "Library" });
    expect(title.className).toContain("font-title");
    expect(title.className).toContain("tracking-[-0.02em]");
  });

  it("paints no band while the cover colour is not ready", () => {
    const { container } = render(<PhoneHeader title="Mix" artwork="https://example.test/cover.jpg" />);
    const header = container.querySelector("header") as HTMLElement;
    expect(header.style.backgroundColor).toBe("");
    expect(header.className).not.toContain("rounded-b-[24px]");
    const title = screen.getByRole("heading", { name: "Mix" });
    expect(title.className).toContain("text-ink-1");
    expect(title.className).toContain("font-title");
  });

  it("leaves the status strip on its default colour without a band", () => {
    render(<PhoneHeader title="Mix" artwork="https://example.test/cover.jpg" />);
    expect(document.documentElement.style.getPropertyValue("--phone-status-bg")).toBe("");
  });

  it("names the playlist in the artwork edit button and avoids redundant nested buttons in h1", () => {
    const onEdit = vi.fn();
    render(<PhoneHeader title="Road Trip" artwork="https://example.test/cover.jpg" onEdit={onEdit} />);
    const editBtn = screen.getByRole("button", { name: "Edit playlist Road Trip" });
    expect(editBtn).toBeTruthy();

    const heading = screen.getByRole("heading", { name: "Road Trip" });
    expect(heading.querySelector("button")).toBeNull();
  });
});
