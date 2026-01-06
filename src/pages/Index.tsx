import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Lock, Users, Settings } from 'lucide-react';

export default function Index() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[hsl(30,50%,97%)] to-[hsl(25,40%,95%)]">
      {/* Header */}
      <header className="border-b border-[hsl(30,30%,90%)] bg-white/60 backdrop-blur-sm">
        <div className="container flex h-16 items-center justify-between px-4 md:px-6">
          <h1 className="text-lg font-semibold text-[hsl(25,30%,25%)]">Subscription Manager</h1>
          <Link to="/admin/login">
            <Button 
              className="bg-[hsl(25,60%,55%)] hover:bg-[hsl(25,60%,50%)] text-white"
            >
              Войти
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="container px-4 md:px-6 py-12 md:py-20 lg:py-24">
        <div className="flex flex-col lg:flex-row lg:items-center lg:gap-12">
          {/* Text Content */}
          <div className="flex-1 text-center lg:text-left">
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight text-[hsl(25,30%,20%)]">
              Удобное управление
              <br />
              <span className="text-[hsl(25,60%,50%)]">подписками Telegram</span>
            </h1>
            <p className="mt-4 md:mt-6 text-base md:text-lg text-[hsl(25,20%,45%)] max-w-xl mx-auto lg:mx-0">
              Личный инструмент для закрытых каналов и сообществ
            </p>
            <div className="mt-6 md:mt-8 flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center lg:justify-start">
              <Link to="/admin/login" className="w-full sm:w-auto">
                <Button 
                  size="lg" 
                  className="w-full sm:w-auto bg-[hsl(25,60%,55%)] hover:bg-[hsl(25,60%,50%)] text-white shadow-lg shadow-[hsl(25,60%,55%)]/20"
                >
                  Начать
                </Button>
              </Link>
              <Link to="/telegram-app" className="w-full sm:w-auto">
                <Button 
                  size="lg" 
                  variant="outline" 
                  className="w-full sm:w-auto border-[hsl(25,40%,80%)] text-[hsl(25,30%,35%)] hover:bg-[hsl(30,50%,95%)]"
                >
                  Посмотреть пример
                </Button>
              </Link>
            </div>
          </div>

          {/* Phone Mockup */}
          <div className="flex-1 mt-10 lg:mt-0 flex justify-center">
            <div className="relative w-[280px] md:w-[300px]">
              {/* Phone Frame */}
              <div className="relative bg-[hsl(220,10%,15%)] rounded-[40px] p-3 shadow-2xl shadow-[hsl(25,40%,30%)]/20">
                {/* Screen */}
                <div className="bg-gradient-to-b from-[hsl(30,45%,96%)] to-[hsl(25,40%,93%)] rounded-[32px] overflow-hidden aspect-[9/19]">
                  {/* Status Bar */}
                  <div className="h-6 bg-[hsl(30,30%,92%)] flex items-center justify-center">
                    <div className="w-20 h-4 bg-[hsl(220,10%,15%)] rounded-full" />
                  </div>
                  
                  {/* App Header */}
                  <div className="bg-[hsl(25,60%,55%)] px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-white/20" />
                      <div className="flex-1">
                        <div className="h-3 w-24 bg-white/80 rounded" />
                        <div className="h-2 w-16 bg-white/50 rounded mt-1" />
                      </div>
                    </div>
                  </div>

                  {/* Chat Messages */}
                  <div className="p-3 space-y-3">
                    {/* Message 1 */}
                    <div className="flex justify-start">
                      <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm max-w-[80%]">
                        <div className="h-2 w-32 bg-[hsl(25,20%,80%)] rounded" />
                        <div className="h-2 w-24 bg-[hsl(25,20%,85%)] rounded mt-1.5" />
                      </div>
                    </div>
                    
                    {/* Message 2 */}
                    <div className="flex justify-end">
                      <div className="bg-[hsl(25,55%,60%)] rounded-2xl rounded-tr-sm p-3 max-w-[80%]">
                        <div className="h-2 w-28 bg-white/60 rounded" />
                        <div className="h-2 w-20 bg-white/40 rounded mt-1.5" />
                      </div>
                    </div>

                    {/* Message 3 */}
                    <div className="flex justify-start">
                      <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm max-w-[80%]">
                        <div className="h-2 w-36 bg-[hsl(25,20%,80%)] rounded" />
                        <div className="h-2 w-28 bg-[hsl(25,20%,85%)] rounded mt-1.5" />
                        <div className="h-2 w-16 bg-[hsl(25,20%,85%)] rounded mt-1.5" />
                      </div>
                    </div>

                    {/* Status Card */}
                    <div className="bg-white rounded-xl p-3 shadow-sm border border-[hsl(30,30%,90%)]">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-3 h-3 rounded-full bg-[hsl(142,70%,45%)]" />
                        <div className="h-2 w-20 bg-[hsl(142,30%,75%)] rounded" />
                      </div>
                      <div className="h-2 w-full bg-[hsl(25,20%,90%)] rounded" />
                      <div className="h-2 w-3/4 bg-[hsl(25,20%,92%)] rounded mt-1.5" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Decorative Elements */}
              <div className="absolute -z-10 -top-6 -right-6 w-32 h-32 bg-[hsl(25,70%,75%)]/30 rounded-full blur-2xl" />
              <div className="absolute -z-10 -bottom-6 -left-6 w-40 h-40 bg-[hsl(30,50%,80%)]/40 rounded-full blur-2xl" />
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="container px-4 md:px-6 pb-16 md:pb-24">
        <div className="grid gap-4 md:gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {/* Card 1 */}
          <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-6 md:p-8 border border-[hsl(30,30%,90%)] shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 rounded-xl bg-[hsl(25,50%,92%)] flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-[hsl(25,60%,50%)]" />
            </div>
            <h3 className="text-lg md:text-xl font-semibold text-[hsl(25,30%,20%)] mb-2">
              Приватный доступ
            </h3>
            <p className="text-[hsl(25,20%,45%)] text-sm md:text-base">
              Контроль доступа в закрытые Telegram-каналы
            </p>
          </div>

          {/* Card 2 */}
          <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-6 md:p-8 border border-[hsl(30,30%,90%)] shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 rounded-xl bg-[hsl(30,50%,92%)] flex items-center justify-center mb-4">
              <Users className="w-6 h-6 text-[hsl(30,55%,45%)]" />
            </div>
            <h3 className="text-lg md:text-xl font-semibold text-[hsl(25,30%,20%)] mb-2">
              Управление каналами
            </h3>
            <p className="text-[hsl(25,20%,45%)] text-sm md:text-base">
              Подписки, сроки и ручное управление
            </p>
          </div>

          {/* Card 3 */}
          <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-6 md:p-8 border border-[hsl(30,30%,90%)] shadow-sm hover:shadow-md transition-shadow sm:col-span-2 lg:col-span-1">
            <div className="w-12 h-12 rounded-xl bg-[hsl(35,50%,92%)] flex items-center justify-center mb-4">
              <Settings className="w-6 h-6 text-[hsl(35,55%,45%)]" />
            </div>
            <h3 className="text-lg md:text-xl font-semibold text-[hsl(25,30%,20%)] mb-2">
              Гибкая настройка
            </h3>
            <p className="text-[hsl(25,20%,45%)] text-sm md:text-base">
              Настройка под собственные сценарии
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[hsl(30,30%,90%)] bg-white/40 py-6 md:py-8">
        <div className="container px-4 md:px-6 text-center text-sm text-[hsl(25,20%,50%)]">
          <p>Личный инструмент управления подписками</p>
        </div>
      </footer>
    </div>
  );
}
