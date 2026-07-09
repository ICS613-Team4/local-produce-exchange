function AboutPage() {
  return (
    <section>
      <h1 className="text-3xl font-bold text-text mb-6">About Surplus</h1>
      <div className="bg-surface rounded-xl border border-border p-8 shadow-sm space-y-4">
        <p className="text-text-muted leading-relaxed">
          Surplus is a local produce exchange built by ICS 613 Team 4. It connects
          neighbors who have extra fruit, vegetables, and other homegrown food with
          people nearby who can use it.
        </p>
        <p className="text-text-muted leading-relaxed">
          Our goal is to reduce food waste in local communities by making it easy
          to share what you grow. Whether you have a backyard garden overflowing
          with tomatoes or a citrus tree producing more than you can eat, Surplus
          helps you find someone who will put that food to good use.
        </p>
      </div>
    </section>
  )
}

export default AboutPage
