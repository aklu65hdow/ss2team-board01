"use client";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { startBoard } from "@/lib/board/board";

export default function Board({ me }) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startBoard({ sb: createClient(), me });
  }, [me]);
  return (
    <>
      <div className="app">
        <nav className="rail" id="rail" aria-label="Блоки доски">
          <div className="brand">Командная доска<small>маркетинг · тесты · созвоны</small></div>
          <div id="nav" />
          <div className="rail-foot" id="me" />
        </nav>
        <main id="main" />
      </div>
      <div className="scrim" id="scrim" />
      <aside className="drawer" id="drawer" aria-hidden="true" />
      <div className="modal" id="modal"><div className="box" id="modalBox" /></div>
      <div className="toast" id="toast" role="status" />
    </>
  );
}
