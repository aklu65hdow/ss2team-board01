import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import Board from "@/components/Board";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { user, profile } = await getMe();
  if (!user) redirect("/login");
  if (!profile || profile.status !== "approved") {
    const blocked = profile && profile.status === "blocked";
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="brand" style={{ padding: 0 }}>Командная доска<small>маркетинг · тесты · созвоны</small></div>
          <h1>{blocked ? "Доступ закрыт" : "Заявка отправлена"}</h1>
          <p className="muted">{blocked
            ? "Администратор закрыл вам доступ к доске. Если это ошибка, напишите руководителю."
            : `Вы вошли как ${user.email}. Администратор увидит заявку и подтвердит доступ. Обновите страницу после подтверждения.`}</p>
          <form action="/auth/signout" method="post"><button className="btn" type="submit">Выйти</button></form>
        </div>
      </div>
    );
  }
  return <Board me={{ id: user.id, email: user.email, name: profile.name, avatar_url: profile.avatar_url, role: profile.role }} />;
}
