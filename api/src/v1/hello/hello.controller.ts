import { Controller, Get } from '@nestjs/common';
import { HelloService } from './hello.service';

@Controller({ path: 'hello', version: '1' })
export class HelloController {
  constructor(private readonly helloService: HelloService) {}

  @Get()
  getHello(): string {
    return this.helloService.getHello();
  }
}
