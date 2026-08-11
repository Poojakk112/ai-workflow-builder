import './globals.css';
import Providers from './providers';

export const metadata = {
  title: 'AI Agent Workflow Builder',
  description: 'A mini n8n for chaining AI agent steps',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
