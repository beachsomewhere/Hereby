export default function NotAuthorizedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAF9F5] px-4">
      <div className="max-w-sm text-center">
        <h1 className="mb-2 text-lg font-semibold text-[#2C2C2A]">Not authorized</h1>
        <p className="text-sm text-[#5F5E5A]">
          This account doesn&rsquo;t have moderator access. If you think this is a mistake, ask an existing
          moderator to promote your account.
        </p>
      </div>
    </div>
  );
}
