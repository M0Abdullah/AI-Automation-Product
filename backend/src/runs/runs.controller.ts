import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequireWrite } from '../auth/auth.guard';
import { CreateRunDto } from './dto/create-run.dto';
import { RunsService } from './runs.service';

@Controller('runs')
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  /** POST /api/runs - the only thing the user has to fill in. */
  @RequireWrite()
  @Post()
  create(@Body() dto: CreateRunDto) {
    return this.runs.create(dto);
  }

  @Get()
  findAll() {
    return this.runs.findAll();
  }

  /** GET /api/runs/:id - everything the run page renders, in one call. */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.runs.findOne(id);
  }

  /** POST /api/runs/:id/execute - run every approved case. */
  @RequireWrite()
  @Post(':id/execute')
  execute(@Param('id') id: string) {
    return this.runs.execute(id);
  }

  /** POST /api/runs/:id/replan - scan again and regenerate the test plan. */
  @RequireWrite()
  @Post(':id/replan')
  replan(@Param('id') id: string) {
    return this.runs.replan(id);
  }
}
